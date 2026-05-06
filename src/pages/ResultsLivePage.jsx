/**
 * ResultsLivePage.jsx
 * TV ekranı — canlı sıralama + yeni puan flash overlay
 *
 * Firebase yolları:
 *   competitions/{compId}/categories   (onValue — gerçek zamanlı)
 *   competitions/{compId}/athletes     (onValue — gerçek zamanlı)
 *   competitions/{compId}/pairs        (onValue — gerçek zamanlı)
 *   competitions/{compId}/results      (onValue — gerçek zamanlı)
 *   live/{compId}/scores/current       (onValue — yayınlanan puan flash tetikleyici)
 *
 * Sıralama mantığı:
 *   Sync kategori  → sadece pair tabanlı sonuçlar (çiftsiz sporcu olmaz)
 *   Bireysel       → athlete bazlı sonuçlar
 *
 * Flash overlay:
 *   Sync:     D  E  S  H
 *   Bireysel: D  E  T  H
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { getScoringRule, getAthleteName, getAthleteClub } from '../lib/DataService';

const ATHLETES_PER_PAGE = 10;
const CYCLE_MS = 8000;

export default function ResultsLivePage() {
    const [params] = useSearchParams();
    const compId = params.get('comp') || params.get('id') || localStorage.getItem('tra_active_comp');

    const [compName,    setCompName]    = useState('');
    const [categories,  setCategories]  = useState({});
    const [athletes,    setAthletes]    = useState([]);
    const [pairs,       setPairs]       = useState([]);
    const [scores,      setScores]      = useState({});
    const [excluded, setExcluded] = useState(() => {
        try { return JSON.parse(localStorage.getItem('tra_rl_excluded') || '[]'); } catch { return []; }
    });
    const [showSettings, setShowSettings] = useState(false);
    const [viewIndex,   setViewIndex]   = useState(0);
    const [flash,       setFlash]       = useState(null);
    const [clock,       setClock]       = useState(() => new Date().toLocaleTimeString('tr-TR'));

    const flashTimerRef  = useRef(null);
    const lastFlashTs    = useRef(0); // Aynı yayının tekrar tetiklenmesini engelle

    // ── Real-time Firebase ────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;
        const unsubs = [];

        // Yarışma adı
        unsubs.push(onValue(ref(db, `competitions/${compId}/name`), snap => {
            if (snap.exists()) setCompName(snap.val());
        }));

        // Kategoriler
        unsubs.push(onValue(ref(db, `competitions/${compId}/categories`), snap => {
            setCategories(snap.val() || {});
        }));

        // Sporcular
        unsubs.push(onValue(ref(db, `competitions/${compId}/athletes`), snap => {
            setAthletes(Object.values(snap.val() || {}));
        }));

        // Çiftler
        unsubs.push(onValue(ref(db, `competitions/${compId}/pairs`), snap => {
            setPairs(Object.values(snap.val() || {}));
        }));

        // Sonuçlar
        unsubs.push(onValue(ref(db, `competitions/${compId}/results`), snap => {
            setScores(snap.val() || {});
        }));

        // Flash tetikleyici — CJP yayınladığında yazar
        unsubs.push(onValue(ref(db, `live/${compId}/scores/current`), snap => {
            if (!snap.exists()) return;
            const data = snap.val();
            if (!data || data.total == null) return;
            // Aynı timestamp'li yayını tekrar gösterme
            if (data.timestamp && data.timestamp === lastFlashTs.current) return;
            lastFlashTs.current = data.timestamp || 0;
            setFlash(data);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setFlash(null), 6000);
        }));

        return () => {
            unsubs.forEach(u => u && u());
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        };
    }, [compId]);

    // Saat
    useEffect(() => {
        const t = setInterval(() => setClock(new Date().toLocaleTimeString('tr-TR')), 1000);
        return () => clearInterval(t);
    }, []);

    // Kategori eşleştirme — id, isim veya tüm bilinen alanlardan biri uyuşursa true
    function athleteInCategory(a, cat) {
        if (!a || !cat) return false;
        const candidates = [a.category, a.categoryId, a.catId].filter(v => v != null && v !== '');
        return candidates.some(v => v === cat.id || v === cat.name);
    }

    // ── Sayfa görünümü listesi (kategori × sayfa) ─────────────────────────
    const views = useMemo(() => {
        const list = Object.values(categories).filter(c => !excluded.includes(c.id));
        const pairsById = {};
        pairs.forEach(p => { if (p?.id) pairsById[p.id] = p; });
        const out = [];
        list.forEach(cat => {
            const catAths = athletes.filter(a => athleteInCategory(a, cat));
            let count;
            if (cat.type === 'sync') {
                const seen = new Set();
                count = 0;
                catAths.forEach(a => {
                    if (a.pairId && pairsById[a.pairId]) {
                        if (!seen.has(a.pairId)) { seen.add(a.pairId); count++; }
                    } else { count++; }
                });
            } else {
                count = catAths.length;
            }
            const totalPages = Math.max(1, Math.ceil(count / ATHLETES_PER_PAGE));
            for (let p = 0; p < totalPages; p++) {
                out.push({ cat, page: p, totalPages });
            }
        });
        return out;
    }, [categories, athletes, pairs, excluded]);

    // Otomatik döngü
    useEffect(() => {
        if (views.length === 0) return;
        const t = setInterval(() => setViewIndex(i => (i + 1) % views.length), CYCLE_MS);
        return () => clearInterval(t);
    }, [views.length]);

    useEffect(() => {
        if (viewIndex >= views.length && views.length > 0) setViewIndex(0);
    }, [views.length]);

    const currentView = views[viewIndex];

    // ── Sıralama hesapla ──────────────────────────────────────────────────
    function computeRanking(cat) {
        const rule   = getScoringRule(cat);
        const isSync = cat.type === 'sync';

        // Pair lookup map (pair.id → pair) — kategoriden bağımsız
        const pairsById = {};
        pairs.forEach(p => { if (p?.id) pairsById[p.id] = p; });

        // Bu kategorideki sporcular
        const catAthletes = athletes.filter(a => athleteInCategory(a, cat));

        if (isSync) {
            // Sync: athletelerin pairId'lerine göre grupla
            const seenPairs = new Set();
            const rows = [];

            catAthletes.forEach(a => {
                if (a.pairId && pairsById[a.pairId]) {
                    // Pair üyesi — sadece bir kere ekle
                    if (seenPairs.has(a.pairId)) return;
                    seenPairs.add(a.pairId);
                    const pair = pairsById[a.pairId];
                    const res = scores[pair.id]
                        || scores[pair.athlete1Id]
                        || scores[pair.athlete2Id]
                        || {};
                    const r1 = res.r1?.total ?? null;
                    const r2 = res.r2?.total ?? null;
                    const s1 = res.r1?.status;
                    const s2 = res.r2?.status;
                    let total = 0;
                    if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
                    else total = (r1 || 0) + (r2 || 0);
                    rows.push({
                        a: {
                            id: pair.id,
                            name: pair.displayName,
                            surname: '',
                            club: pair.club || a.club || '',
                            isPair: true,
                            pairName: pair.displayName,
                        },
                        r1, r2, s1, s2, total,
                    });
                } else {
                    // Eşleştirilmemiş sporcu — bireysel göster
                    const res = scores[a.uniqueId] || scores[a.id] || {};
                    const r1 = res.r1?.total ?? null;
                    const r2 = res.r2?.total ?? null;
                    const s1 = res.r1?.status;
                    const s2 = res.r2?.status;
                    let total = 0;
                    if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
                    else total = (r1 || 0) + (r2 || 0);
                    rows.push({ a, r1, r2, s1, s2, total });
                }
            });
            rows.sort((a, b) => b.total - a.total);
            return rows;
        }

        // Bireysel kategori
        const rows = catAthletes.map(a => {
            const res = scores[a.uniqueId] || scores[a.id] || {};
            const r1  = res.r1?.total ?? null;
            const r2  = res.r2?.total ?? null;
            const s1  = res.r1?.status;
            const s2  = res.r2?.status;
            let total = 0;
            if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
            else total = (r1 || 0) + (r2 || 0);
            return { a, r1, r2, s1, s2, total };
        });
        rows.sort((a, b) => b.total - a.total);
        return rows;
    }

    function fmtScore(val, status) {
        if (status === 'dns') return 'DNS';
        if (status === 'dnf') return 'DNF';
        if (val == null) return '-';
        return Number(val).toFixed(3);
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    }

    function toggleExcluded(id) {
        setExcluded(prev => {
            const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
            localStorage.setItem('tra_rl_excluded', JSON.stringify(next));
            return next;
        });
    }

    const ranking  = currentView ? computeRanking(currentView.cat) : [];
    const pageStart = currentView ? currentView.page * ATHLETES_PER_PAGE : 0;
    const pageRows  = ranking.slice(pageStart, pageStart + ATHLETES_PER_PAGE);

    // Flash için sync tespiti
    const flashIsSync = flash?.isPair === true || (flash && flash.s > 0 && !flash.t);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'radial-gradient(circle at top right, #1e293b 0%, #0f172a 60%, #020617 100%)',
            color: 'white', fontFamily: "'Outfit', sans-serif", display: 'flex', flexDirection: 'column',
        }}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <div style={{
                padding: '14px 24px', background: 'rgba(255,255,255,0.04)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: 1 }}>
                    {compName || 'TCF TRAMBOLİN'} — CANLI SIRALAMA
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {currentView && (
                        <div style={{
                            background: 'rgba(244,63,94,0.15)', color: '#f43f5e',
                            padding: '4px 12px', borderRadius: 6, fontSize: '0.82rem', fontWeight: 700,
                        }}>
                            {currentView.cat.type === 'sync' && (
                                <i className="material-icons-round" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4, color: '#c084fc' }}>sync</i>
                            )}
                            {currentView.cat.name}
                            {currentView.totalPages > 1 && ` — ${currentView.page + 1}/${currentView.totalPages}`}
                        </div>
                    )}
                    <button onClick={() => setShowSettings(s => !s)} className="btn btn-sm btn-outline">
                        <i className="material-icons-round">settings</i>
                    </button>
                    <button onClick={toggleFullscreen} className="btn btn-sm btn-outline">
                        <i className="material-icons-round">fullscreen</i>
                    </button>
                </div>
            </div>

            {/* ── Sıralama Listesi ─────────────────────────────────────── */}
            <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
                {!currentView && (
                    <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                        Kategori bekleniyor...
                    </div>
                )}
                {currentView && pageRows.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                        Bu kategoride sporcu/puan yok.
                    </div>
                )}
                {pageRows.map((row, i) => {
                    const rank  = pageStart + i + 1;
                    const medal = rank <= 3;
                    const rankColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : 'white';
                    return (
                        <div key={row.a.id} style={{
                            display: 'grid',
                            gridTemplateColumns: '60px 1fr 140px 140px 170px',
                            alignItems: 'center', gap: 16,
                            padding: '16px 20px', marginBottom: 10,
                            background: medal ? `rgba(${rank===1?'253,185,49':rank===2?'192,192,192':'205,127,50'},0.07)` : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${medal ? `rgba(${rank===1?'253,185,49':rank===2?'192,192,192':'205,127,50'},0.3)` : 'rgba(255,255,255,0.06)'}`,
                            borderRadius: 12,
                        }}>
                            <div style={{
                                fontFamily: "'Space Mono',monospace",
                                fontSize: '2rem', fontWeight: 900,
                                textAlign: 'center', color: rankColor,
                            }}>
                                {rank}
                            </div>
                            <div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>
                                    {row.a.isPair ? (
                                        <span>
                                            <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4, color: '#c084fc' }}>sync</i>
                                            {row.a.pairName}
                                        </span>
                                    ) : (
                                        getAthleteName(row.a).toUpperCase()
                                    )}
                                </div>
                                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>{getAthleteClub(row.a) || row.a.club || ''}</div>
                            </div>
                            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '1.2rem', textAlign: 'center', color: '#cbd5e1' }}>
                                R1: {fmtScore(row.r1, row.s1)}
                            </div>
                            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '1.2rem', textAlign: 'center', color: '#cbd5e1' }}>
                                R2: {fmtScore(row.r2, row.s2)}
                            </div>
                            <div style={{
                                fontFamily: "'Space Mono',monospace",
                                fontSize: '2rem', fontWeight: 900,
                                textAlign: 'right',
                                color: medal ? rankColor : '#38bdf8',
                            }}>
                                {row.total > 0 ? row.total.toFixed(3) : (row.r1 != null || row.r2 != null ? row.total.toFixed(3) : '—')}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <div style={{
                padding: '10px 24px', background: 'rgba(255,255,255,0.04)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: '0.85rem', color: '#64748b',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                    CANLI — {clock}
                </div>
                <div>TCF — TÜRKİYE CİMNASTİK FEDERASYONU</div>
            </div>

            {/* ── Flash Overlay ────────────────────────────────────────── */}
            {flash && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, animation: 'fadeIn 0.3s',
                }}>
                    <div style={{
                        background: 'radial-gradient(circle at 30% 30%, #1e293b, #020617)',
                        padding: '50px 60px', borderRadius: 24, textAlign: 'center',
                        border: `2px solid ${flashIsSync ? '#c084fc' : '#38bdf8'}`,
                        minWidth: 620, maxWidth: '90vw',
                        boxShadow: `0 0 80px ${flashIsSync ? 'rgba(192,132,252,0.4)' : 'rgba(56,189,248,0.5)'}`,
                    }}>
                        {/* Etiket */}
                        <div style={{ fontSize: '0.85rem', color: '#64748b', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
                            {flashIsSync
                                ? <span><i className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4, color: '#c084fc' }}>sync</i>SENKRONİZE PUAN</span>
                                : 'YENİ PUAN'
                            }
                            {flash.routine && <span style={{ marginLeft: 8, color: '#475569' }}>— {flash.routine}. SERİ</span>}
                        </div>

                        {/* Sporcu / Çift adı */}
                        <div style={{
                            fontSize: flashIsSync ? '2.4rem' : '3.2rem',
                            fontWeight: 900, marginBottom: 8, lineHeight: 1.15,
                            color: 'white',
                        }}>
                            {flashIsSync && flash.pairName ? (
                                <span>
                                    <i className="material-icons-round" style={{ fontSize: 28, verticalAlign: 'middle', marginRight: 8, color: '#c084fc' }}>sync</i>
                                    {flash.pairName}
                                </span>
                            ) : (
                                flash.athleteName || ''
                            )}
                        </div>

                        {/* Kulüp */}
                        <div style={{ fontSize: '1.1rem', color: '#64748b', marginBottom: 32 }}>
                            {flash.club || ''}
                        </div>

                        {/* Puan kutuları — SYNC: D E S H | BİREYSEL: D E T H */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20, marginBottom: 36 }}>
                            <MiniScore label="D"
                                value={flash.d?.toFixed(1)}
                                color="#f59e0b" />
                            <MiniScore label="E"
                                value={flash.e?.toFixed(2)}
                                color="#10b981" />
                            {flashIsSync
                                ? <MiniScore label="S"
                                    value={flash.sRaw != null ? flash.sRaw.toFixed(2) : flash.s?.toFixed(2)}
                                    color="#c084fc"
                                    sublabel="×2" />
                                : <MiniScore label="T"
                                    value={flash.t?.toFixed(3)}
                                    color="#38bdf8" />
                            }
                            <MiniScore label="H"
                                value={flash.h?.toFixed(2)}
                                color="#a855f7" />
                        </div>

                        {/* Toplam */}
                        <div style={{
                            fontFamily: "'Space Mono',monospace",
                            fontSize: '5.5rem', fontWeight: 900,
                            color: flashIsSync ? '#c084fc' : '#38bdf8',
                            textShadow: `0 0 50px ${flashIsSync ? 'rgba(192,132,252,0.6)' : 'rgba(56,189,248,0.6)'}`,
                            lineHeight: 1,
                        }}>
                            {flash.total?.toFixed(3)}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Ayarlar modal ────────────────────────────────────────── */}
            {showSettings && (
                <div onClick={e => e.target === e.currentTarget && setShowSettings(false)} style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#0f172a', borderRadius: 16, padding: 28,
                        width: 520, maxWidth: '90%', border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                        <h3 style={{ marginTop: 0 }}>Gösterilecek Kategoriler</h3>
                        <div style={{ maxHeight: 400, overflow: 'auto' }}>
                            {Object.values(categories).map(c => (
                                <label key={c.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: 8, cursor: 'pointer',
                                }}>
                                    <input type="checkbox"
                                        checked={!excluded.includes(c.id)}
                                        onChange={() => toggleExcluded(c.id)} />
                                    {c.type === 'sync' && (
                                        <i className="material-icons-round" style={{ fontSize: 14, color: '#c084fc' }}>sync</i>
                                    )}
                                    {c.name}
                                </label>
                            ))}
                        </div>
                        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}
                            onClick={() => setShowSettings(false)}>
                            KAPAT
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Mini Puan Kutusu ──────────────────────────────────────────────────────────
function MiniScore({ label, value, color, sublabel }) {
    return (
        <div>
            <div style={{
                fontSize: '0.75rem', fontWeight: 700, color, letterSpacing: 2, marginBottom: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            }}>
                {label}
                {sublabel && <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>{sublabel}</span>}
            </div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '2rem', fontWeight: 700 }}>
                {value ?? '—'}
            </div>
        </div>
    );
}
