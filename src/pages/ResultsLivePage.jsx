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
import {
    getScoringRule, getAthleteName, getAthleteClub,
    isDNX, formatResultScore, computeRoutineTotals, getPairDisplayName, computeTeamRanking,
} from '../lib/DataService';
import { useRules, resolveCategoryRules, resolveTeamSourceCategory } from '../lib/Rules';



export default function ResultsLivePage() {
    const [params] = useSearchParams();
    const compId = params.get('comp') || params.get('id') || localStorage.getItem('tra_active_comp');
    const rules = useRules(compId);
    const TEAMS_PER_PAGE = rules.session.teamsPerPage;
    const ATHLETES_PER_PAGE = rules.session.athletesPerPage;
    const CYCLE_MS = rules.session.liveCycleSeconds * 1000;

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


    // Çift adını ad+soyad olarak kurmak için kimliğe göre sporcu haritası
    const athletesById = useMemo(() => {
        const m = {};
        athletes.forEach(a => { if (a?.id) m[a.id] = a; });
        return m;
    }, [athletes]);

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
                out.push({ cat, page: p, totalPages, kind: 'individual' });
            }
            // Takımı açık kategorilerde bireysel sayfalardan sonra takım sayfası.
            // Boşsa (yeterli sporcusu olan kulüp yok) döngüye hiç eklenmez.
            // Takım sayfası yalnızca ELEME kategorilerinde döngüye girer;
            // final ve senkron kategorilerde kaynak null gelir.
            const srcCat = resolveTeamSourceCategory(rules, cat);
            const cr = srcCat ? resolveCategoryRules(rules, srcCat) : null;
            if (srcCat) {
                const teams = computeTeamRanking(computeRanking(srcCat), {
                    topN: cr.teamTopN,
                    minAthletes: cr.teamMinAthletes,
                    mode: cr.teamMode,
                    perRoutineMinAthletes: cr.teamPerRoutineMinAthletes,
                    routineCount: cr.routineCount,
                    scoringRule: cr.teamScoringRule,
                });
                // Takım kartları bireysel satırlardan yüksek; TV'de taşmasın
                // diye sayfalanır.
                if (teams.length > 0) {
                    const tp = Math.max(1, Math.ceil(teams.length / TEAMS_PER_PAGE));
                    for (let p = 0; p < tp; p++) {
                        out.push({ cat, page: p, totalPages: tp, kind: 'team' });
                    }
                }
            }
        });
        return out;
    }, [categories, athletes, pairs, excluded, ATHLETES_PER_PAGE, TEAMS_PER_PAGE, scores, rules]);

    // Otomatik döngü
    useEffect(() => {
        if (views.length === 0) return;
        const t = setInterval(() => setViewIndex(i => (i + 1) % views.length), CYCLE_MS);
        return () => clearInterval(t);
    }, [views.length, CYCLE_MS]);

    useEffect(() => {
        if (viewIndex >= views.length && views.length > 0) setViewIndex(0);
    }, [views.length]);

    const currentView = views[viewIndex];

    // ── Sıralama hesapla ──────────────────────────────────────────────────
    function computeRanking(cat) {
        const rule   = resolveCategoryRules(rules, cat).scoringRule;
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
                    const s1 = res.r1?.status;
                    const s2 = res.r2?.status;
                    // DNS/DNF → sıralama dışı (null)
                    const { r1, r2, total } = computeRoutineTotals(res.r1, res.r2, rule);
                    rows.push({
                        a: {
                            id: pair.id,
                            name: getPairDisplayName(pair, athletesById),
                            surname: '',
                            club: pair.club || a.club || '',
                            isPair: true,
                            pairName: getPairDisplayName(pair, athletesById),
                        },
                        r1, r2, s1, s2, total,
                    });
                } else {
                    // Eşleştirilmemiş sporcu — bireysel göster
                    const res = scores[a.uniqueId] || scores[a.id] || {};
                    const s1 = res.r1?.status;
                    const s2 = res.r2?.status;
                    const { r1, r2, total } = computeRoutineTotals(res.r1, res.r2, rule);
                    rows.push({ a, r1, r2, s1, s2, total });
                }
            });
            return assignRanks(rows);
        }

        // Bireysel kategori
        const rows = catAthletes.map(a => {
            const res = scores[a.uniqueId] || scores[a.id] || {};
            const s1  = res.r1?.status;
            const s2  = res.r2?.status;
            // DNS/DNF → sıralama dışı (null)
            const { r1, r2, total } = computeRoutineTotals(res.r1, res.r2, rule);
            return { a, r1, r2, s1, s2, total };
        });
        return assignRanks(rows);
    }

    // Sıralama atamayı standart spor mantığıyla yap:
    //  • Puanı olan satırlar üstte sıralanır, eşitler aynı rank alır (1,2,2,4)
    //  • Hiç puanı olmayan satırlar listenin sonuna gider, rank verilmez (null)
    function assignRanks(rows) {
        const scored   = rows.filter(r => r.r1 != null || r.r2 != null);
        const unscored = rows.filter(r => r.r1 == null && r.r2 == null);
        scored.sort((a, b) => b.total - a.total);

        let lastTotal = null;
        let lastRank  = 0;
        scored.forEach((row, i) => {
            if (lastTotal !== null && row.total === lastTotal) {
                row.rank = lastRank;          // berabere → aynı rank
            } else {
                row.rank = i + 1;             // yeni rank = sıra + 1
                lastRank = row.rank;
                lastTotal = row.total;
            }
        });
        unscored.forEach(r => { r.rank = null; });
        return [...scored, ...unscored];
    }

    const fmtScore = (val, status) => formatResultScore(val, status, '—');

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

    const isTeamView = currentView?.kind === 'team';
    const ranking  = currentView ? computeRanking(currentView.cat) : [];
    // Takım yalnızca eleme kategorilerinde gösterilir.
    const teamSrcCat = currentView ? resolveTeamSourceCategory(rules, currentView.cat) : null;
    const teamRows = (() => {
        if (!isTeamView || !teamSrcCat) return [];
        const cr = resolveCategoryRules(rules, teamSrcCat);
        const all = computeTeamRanking(ranking, {
            topN: cr.teamTopN,
            minAthletes: cr.teamMinAthletes,
            mode: cr.teamMode,
            perRoutineMinAthletes: cr.teamPerRoutineMinAthletes,
            routineCount: cr.routineCount,
            scoringRule: cr.teamScoringRule,
        });
        const st = currentView.page * TEAMS_PER_PAGE;
        return all.slice(st, st + TEAMS_PER_PAGE);
    })();
    const pageStart = currentView ? currentView.page * ATHLETES_PER_PAGE : 0;
    const pageRows  = ranking.slice(pageStart, pageStart + ATHLETES_PER_PAGE);

    // Flash için sync tespiti
    const flashIsSync = flash?.isPair === true || (flash && flash.s > 0 && !flash.t);

    // Flash'taki sporcunun ANLIK sırası. `scores` dinleyicisiyle birlikte
    // yeniden hesaplanır; yayınlanan puan listeye düştüğü anda sıra güncellenir.
    // Kimliği olmayan eski kayıtlar için ada göre eşleme yedeği var.
    const flashRank = useMemo(() => {
        if (!flash) return null;
        const cat = flash.categoryId ? categories[flash.categoryId] : null;
        const cats = cat ? [cat] : Object.values(categories);
        for (const c of cats) {
            const rows = computeRanking(c);
            const hit = rows.find(r =>
                (flash.athleteId && (r.a.id === flash.athleteId || r.a.uniqueId === flash.athleteId)) ||
                (!flash.athleteId && getAthleteName(r.a) === flash.athleteName)
            );
            if (hit) return { rank: hit.rank, total: rows.filter(x => x.rank != null).length };
        }
        return null;
    }, [flash, categories, athletes, pairs, scores, rules]);

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
                            background: 'rgba(224,40,40,0.15)', color: '#E02828',
                            padding: '4px 12px', borderRadius: 6, fontSize: '0.82rem', fontWeight: 700,
                        }}>
                            {currentView.cat.type === 'sync' && (
                                <i className="material-icons-round" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4, color: '#c084fc' }}>sync</i>
                            )}
                            {currentView.cat.name}
                            {isTeamView && ' — TAKIM'}
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
                {/* ── Takım sıralaması ─────────────────────────────── */}
                {isTeamView && teamRows.map((t, i) => {
                    const rank = currentView.page * TEAMS_PER_PAGE + i + 1;
                    const medal = rank <= 3;
                    const rankColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '#7C87D8';
                    return (
                        <div key={t.club} style={{
                            marginBottom: 10, borderRadius: 14, overflow: 'hidden',
                            background: medal ? `${rankColor}0D` : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${medal ? `${rankColor}44` : 'rgba(255,255,255,0.07)'}`,
                        }}>
                            {/* Üst şerit — sıra, kulüp, takım toplamı */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 16,
                                padding: '9px 20px',
                                background: medal ? `${rankColor}14` : 'rgba(255,255,255,0.02)',
                                borderBottom: '1px solid rgba(255,255,255,0.07)',
                            }}>
                                <div style={{
                                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: medal ? rankColor : 'rgba(255,255,255,0.08)',
                                    color: medal ? '#0A0E20' : '#A3ACD0',
                                    fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: '1.3rem',
                                }}>
                                    {rank}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '1.4rem', fontWeight: 800, color: 'white', lineHeight: 1.15,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {t.club}
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: '#A3ACD0', marginTop: 2 }}>
                                        {t.members.length} sporcu
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontSize: '0.72rem', color: '#A3ACD0', letterSpacing: 1.5, fontWeight: 700 }}>
                                        TAKIM TOPLAMI
                                    </div>
                                    <div style={{
                                        fontFamily: "'Space Mono', monospace", fontSize: '1.85rem',
                                        fontWeight: 700, color: medal ? rankColor : 'white', lineHeight: 1.05,
                                    }}>
                                        {t.teamTotal.toFixed(3)}
                                    </div>
                                </div>
                            </div>

                            {/* Seri blokları — hangi sporcunun puanı hangi seriden */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${t.routines.length}, 1fr)`,
                                gap: 1, background: 'rgba(255,255,255,0.06)',
                            }}>
                                {t.routines.map(rt => (
                                    <div key={rt.key} style={{ background: 'rgba(10,14,32,0.55)', padding: '8px 20px' }}>
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between',
                                            alignItems: 'baseline', marginBottom: 5,
                                        }}>
                                            <span style={{
                                                fontSize: '0.8rem', fontWeight: 800, letterSpacing: 1.5,
                                                color: rt.key === 'r1' ? 'var(--accent-primary)' : 'var(--accent-secondary)',
                                            }}>
                                                {rt.label.toUpperCase()}
                                            </span>
                                            <span style={{
                                                fontFamily: "'Space Mono', monospace", fontWeight: 700,
                                                fontSize: '1.1rem', color: '#e2e8f0',
                                            }}>
                                                {rt.subtotal.toFixed(3)}
                                            </span>
                                        </div>
                                        {rt.picks.length === 0 ? (
                                            <div style={{ color: '#475569', fontSize: '0.95rem' }}>
                                                Bu seriden puan sayılmadı
                                            </div>
                                        ) : rt.picks.map((pk, idx) => (
                                            <div key={idx} style={{
                                                display: 'flex', justifyContent: 'space-between',
                                                alignItems: 'center', gap: 12, padding: '2px 0',
                                                fontSize: '0.95rem',
                                                borderBottom: idx < rt.picks.length - 1 ? '1px dashed rgba(255,255,255,0.07)' : 'none',
                                            }}>
                                                <span style={{
                                                    color: pk.counted ? '#cbd5e1' : '#64748b',
                                                    textDecoration: pk.counted ? 'none' : 'line-through',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>
                                                    {pk.name}
                                                </span>
                                                <span style={{
                                                    fontFamily: "'Space Mono', monospace",
                                                    color: pk.counted ? '#A3ACD0' : '#525C82',
                                                    textDecoration: pk.counted ? 'none' : 'line-through',
                                                    flexShrink: 0,
                                                }}>
                                                    {pk.score.toFixed(3)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}

                {currentView && !isTeamView && pageRows.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                        Bu kategoride sporcu/puan yok.
                    </div>
                )}
                {!isTeamView && pageRows.map((row, i) => {
                    const rank  = row.rank;                  // null = henüz puansız
                    const medal = rank != null && rank <= 3;
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
                                {rank ?? '—'}
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
                                color: medal ? rankColor : '#7C87D8',
                            }}>
                                {(() => {
                                    // Her iki seri de DNS/DNF ise toplam gösterme
                                    const allDNX = isDNX(row.s1) && isDNX(row.s2);
                                    if (allDNX) return <span style={{ fontSize: '1.1rem', color: '#94a3b8' }}>DNS/DNF</span>;
                                    if (row.r1 == null && row.r2 == null) return '—';
                                    return row.total.toFixed(3);
                                })()}
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
                        border: `2px solid ${flashIsSync ? '#c084fc' : '#7C87D8'}`,
                        minWidth: 620, maxWidth: '90vw',
                        boxShadow: `0 0 80px ${flashIsSync ? 'rgba(192,132,252,0.4)' : 'rgba(124,135,216,0.5)'}`,
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

                        {/* Kulüp + anlık sıra */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 16, marginBottom: 32, flexWrap: 'wrap',
                        }}>
                            <span style={{ fontSize: '1.1rem', color: '#A3ACD0' }}>
                                {flash.club || ''}
                            </span>
                            {flashRank?.rank != null && (() => {
                                const r = flashRank.rank;
                                const medal = r === 1 ? '#FFD700' : r === 2 ? '#C0C0C0' : r === 3 ? '#CD7F32' : null;
                                return (
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 10,
                                        background: medal ? `${medal}1F` : 'rgba(124,135,216,0.15)',
                                        border: `1px solid ${medal ? `${medal}66` : 'rgba(124,135,216,0.4)'}`,
                                        borderRadius: 10, padding: '6px 16px',
                                    }}>
                                        <span style={{
                                            fontSize: '0.72rem', letterSpacing: 2, fontWeight: 800,
                                            color: medal || 'var(--accent-secondary)',
                                        }}>
                                            SIRA
                                        </span>
                                        <span style={{
                                            fontFamily: "'Space Mono', monospace", fontWeight: 700,
                                            fontSize: '1.9rem', lineHeight: 1,
                                            color: medal || 'white',
                                        }}>
                                            {r}
                                        </span>
                                        {flashRank.total > 0 && (
                                            <span style={{ fontSize: '0.9rem', color: '#A3ACD0' }}>
                                                / {flashRank.total}
                                            </span>
                                        )}
                                    </span>
                                );
                            })()}
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
                                    color="#7C87D8" />
                            }
                            <MiniScore label="H"
                                value={flash.h?.toFixed(2)}
                                color="#a855f7" />
                        </div>

                        {/* Toplam */}
                        <div style={{
                            fontFamily: "'Space Mono',monospace",
                            fontSize: '5.5rem', fontWeight: 900,
                            color: flashIsSync ? '#c084fc' : '#7C87D8',
                            textShadow: `0 0 50px ${flashIsSync ? 'rgba(192,132,252,0.6)' : 'rgba(124,135,216,0.6)'}`,
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
