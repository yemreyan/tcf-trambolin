/**
 * ResultsLivePage.jsx
 * Mevcut results_live.html — TV ekran canlı sıralama.
 * Kategorileri döngüye alır; her yeni skor geldiğinde flash overlay gösterir.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}
 *   competitions/{compId}/athletes
 *   competitions/{compId}/results
 *   live/{compId}/scores/current  (flash için tetikleyici)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { getScoringRule, getAthleteName, getAthleteClub } from '../lib/DataService';

const ATHLETES_PER_PAGE = 10;
const CYCLE_MS = 8000;

export default function ResultsLivePage() {
    const [params] = useSearchParams();
    const compId = params.get('comp') || localStorage.getItem('tra_active_comp');

    const [compName, setCompName] = useState('');
    const [categories, setCategories] = useState({});
    const [athletes, setAthletes] = useState([]);
    const [pairs, setPairs] = useState([]);
    const [scores, setScores] = useState({});
    const [excluded, setExcluded] = useState(() => {
        const s = localStorage.getItem('tra_rl_excluded');
        return s ? JSON.parse(s) : [];
    });
    const [showSettings, setShowSettings] = useState(false);
    const [viewIndex, setViewIndex] = useState(0);
    const [flash, setFlash] = useState(null);
    const [clock, setClock] = useState(() => new Date().toLocaleTimeString('tr-TR'));

    const flashTimerRef = useRef(null);

    // ── Load + listen ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;

        (async () => {
            const snap = await get(ref(db, `competitions/${compId}`));
            if (!snap.exists()) return;
            const comp = snap.val();
            setCompName(comp.name || '');
            setCategories(comp.categories || {});
            setAthletes(Object.values(comp.athletes || {}));
            setPairs(Object.values(comp.pairs || {}));
        })();

        const unsubRes = onValue(ref(db, `competitions/${compId}/results`), snap => {
            setScores(snap.val() || {});
        });

        const unsubLive = onValue(ref(db, `live/${compId}/scores/current`), snap => {
            const data = snap.val();
            if (!data) return;
            setFlash(data);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setFlash(null), 6000);
        });

        return () => { unsubRes(); unsubLive(); if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
    }, [compId]);

    // Clock
    useEffect(() => {
        const t = setInterval(() => setClock(new Date().toLocaleTimeString('tr-TR')), 1000);
        return () => clearInterval(t);
    }, []);

    // ── Build views (category pages) ──────────────────────────────────────
    const views = useMemo(() => {
        const list = Object.values(categories).filter(c => !excluded.includes(c.id));
        const out = [];
        list.forEach(cat => {
            const count = cat.type === 'sync'
                ? pairs.filter(p => p.categoryId === cat.id).length
                : athletes.filter(a =>
                    (a.category === cat.id) || (a.categoryId === cat.id) || (a.catId === cat.id)
                  ).length;
            const totalPages = Math.max(1, Math.ceil(count / ATHLETES_PER_PAGE));
            for (let p = 0; p < totalPages; p++) {
                out.push({ cat, page: p, totalPages });
            }
        });
        return out;
    }, [categories, athletes, pairs, excluded]);

    // Cycle
    useEffect(() => {
        if (views.length === 0) return;
        const t = setInterval(() => {
            setViewIndex(i => (i + 1) % views.length);
        }, CYCLE_MS);
        return () => clearInterval(t);
    }, [views.length]);

    // Reset view index if view count shrinks
    useEffect(() => {
        if (viewIndex >= views.length && views.length > 0) setViewIndex(0);
    }, [views.length]);

    const currentView = views[viewIndex];

    // ── Sıralama hesapla ──────────────────────────────────────────────────
    function computeRanking(cat) {
        const rule = getScoringRule(cat);
        const isSync = cat.type === 'sync';

        if (isSync) {
            const catPairs = pairs.filter(p => p.categoryId === cat.id);
            const rows = catPairs.map(pair => {
                const res = scores[pair.id] || {};
                const r1 = res.r1?.total ?? null;
                const r2 = res.r2?.total ?? null;
                const s1 = res.r1?.status;
                const s2 = res.r2?.status;
                let total = 0;
                if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
                else total = (r1 || 0) + (r2 || 0);
                const a = {
                    id: pair.id,
                    name: pair.displayName,
                    surname: '',
                    club: pair.club || '',
                    isPair: true,
                    pairName: pair.displayName,
                };
                return { a, r1, r2, s1, s2, total };
            });
            rows.sort((a, b) => b.total - a.total);
            return rows;
        }

        const filtered = athletes.filter(a =>
            (a.category === cat.id) || (a.categoryId === cat.id) || (a.catId === cat.id)
        );
        const rows = filtered.map(a => {
            const res = scores[a.uniqueId] || scores[a.id] || {};
            const r1 = res.r1?.total ?? null;
            const r2 = res.r2?.total ?? null;
            const s1 = res.r1?.status;
            const s2 = res.r2?.status;
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

    const ranking = currentView ? computeRanking(currentView.cat) : [];
    const pageStart = currentView ? currentView.page * ATHLETES_PER_PAGE : 0;
    const pageRows = ranking.slice(pageStart, pageStart + ATHLETES_PER_PAGE);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'radial-gradient(circle at top right, #1e293b 0%, #0f172a 60%, #020617 100%)',
            color: 'white', fontFamily: "'Outfit', sans-serif", display: 'flex', flexDirection: 'column',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 24px', background: 'rgba(255,255,255,0.04)',
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
                            {currentView.cat.name} — SAYFA {currentView.page + 1}/{currentView.totalPages}
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

            {/* Ranking */}
            <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
                {!currentView && (
                    <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                        Kategori bekleniyor...
                    </div>
                )}

                {currentView && pageRows.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                        Bu kategoride sporcu yok
                    </div>
                )}

                {pageRows.map((row, i) => {
                    const rank = pageStart + i + 1;
                    const medal = rank <= 3;
                    return (
                        <div key={row.a.id} style={{
                            display: 'grid', gridTemplateColumns: '60px 1fr 140px 140px 160px',
                            alignItems: 'center', gap: 16,
                            padding: '16px 20px', marginBottom: 10,
                            background: medal ? 'rgba(253,185,49,0.08)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${medal ? 'rgba(253,185,49,0.3)' : 'rgba(255,255,255,0.06)'}`,
                            borderRadius: 12,
                        }}>
                            <div style={{
                                fontFamily: "'Space Mono',monospace", fontSize: '2rem', fontWeight: 900,
                                textAlign: 'center',
                                color: rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : 'white',
                            }}>{rank}</div>
                            <div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>
                                    {row.a.isPair
                                        ? <span><i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4, color: '#c084fc' }}>sync</i>{row.a.pairName}</span>
                                        : <>{getAthleteName(row.a).toUpperCase()}</>
                                    }
                                </div>
                                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>{getAthleteClub(row.a)}</div>
                            </div>
                            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '1.2rem', textAlign: 'center', color: '#cbd5e1' }}>
                                R1: {fmtScore(row.r1, row.s1)}
                            </div>
                            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '1.2rem', textAlign: 'center', color: '#cbd5e1' }}>
                                R2: {fmtScore(row.r2, row.s2)}
                            </div>
                            <div style={{
                                fontFamily: "'Space Mono',monospace", fontSize: '1.9rem', fontWeight: 900,
                                textAlign: 'right', color: '#38bdf8',
                            }}>
                                {row.total ? row.total.toFixed(3) : '-'}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div style={{
                padding: '10px 24px', background: 'rgba(255,255,255,0.04)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: '0.85rem', color: '#64748b',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                        width: 10, height: 10, borderRadius: '50%', background: '#10b981',
                        boxShadow: '0 0 10px #10b981',
                    }} />
                    CANLI — {clock}
                </div>
                <div>TCF — TÜRKİYE CİMNASTİK FEDERASYONU</div>
            </div>

            {/* Flash overlay */}
            {flash && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, animation: 'fadeIn 0.3s',
                }}>
                    <div style={{
                        background: 'radial-gradient(circle, #1e293b, #020617)',
                        padding: 60, borderRadius: 24, textAlign: 'center',
                        border: '2px solid #38bdf8', minWidth: 600,
                        boxShadow: '0 0 60px rgba(56,189,248,0.5)',
                    }}>
                        <div style={{ fontSize: '1rem', color: '#94a3b8', letterSpacing: 3, marginBottom: 12 }}>
                            YENİ PUAN
                        </div>
                        <div style={{ fontSize: flash.isPair ? '2.4rem' : '3.5rem', fontWeight: 900, marginBottom: 10, lineHeight: 1.2 }}>
                            {flash.isPair && flash.pairName
                                ? <span><i className="material-icons-round" style={{ fontSize: 28, verticalAlign: 'middle', marginRight: 8, color: '#c084fc' }}>sync</i>{flash.pairName}</span>
                                : flash.athleteName || ''
                            }
                        </div>
                        <div style={{ fontSize: '1.2rem', color: '#94a3b8', marginBottom: 30 }}>
                            {flash.club || ''}
                        </div>
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20, marginBottom: 30,
                        }}>
                            <MiniScore label="D" value={flash.d?.toFixed(1)} color="#f59e0b" />
                            <MiniScore label="E" value={flash.e?.toFixed(2)} color="#10b981" />
                            <MiniScore label="T" value={flash.t?.toFixed(3)} color="#38bdf8" />
                            {flash.isPair
                                ? <MiniScore label="S" value={flash.s?.toFixed(2)} color="#c084fc" />
                                : <MiniScore label="H" value={flash.h?.toFixed(1)} color="#a855f7" />
                            }
                        </div>
                        <div style={{
                            fontFamily: "'Space Mono',monospace", fontSize: '5rem', fontWeight: 900, color: '#38bdf8',
                            textShadow: '0 0 40px rgba(56,189,248,0.6)',
                        }}>
                            {flash.total?.toFixed(3)}
                        </div>
                    </div>
                </div>
            )}

            {/* Settings modal */}
            {showSettings && (
                <div onClick={e => e.target === e.currentTarget && setShowSettings(false)} style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#0f172a', borderRadius: 16, padding: 24,
                        width: 520, maxWidth: '90%', border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                        <h3 style={{ marginTop: 0 }}>Gösterilecek Kategoriler</h3>
                        <div style={{ maxHeight: 400, overflow: 'auto' }}>
                            {Object.values(categories).map(c => (
                                <label key={c.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: 8, cursor: 'pointer',
                                }}>
                                    <input type="checkbox" checked={!excluded.includes(c.id)}
                                        onChange={() => toggleExcluded(c.id)} />
                                    {c.name}
                                </label>
                            ))}
                        </div>
                        <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }}
                            onClick={() => setShowSettings(false)}>KAPAT</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function MiniScore({ label, value, color }) {
    return (
        <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color, letterSpacing: 2, marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '2rem', fontWeight: 700 }}>
                {value ?? '-'}
            </div>
        </div>
    );
}
