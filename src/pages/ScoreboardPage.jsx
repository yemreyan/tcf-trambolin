/**
 * ScoreboardPage.jsx
 * Mevcut scoreboard.html — Projeksiyon/TV seyirci ekranı
 *
 * Çalışma mantığı:
 * - live/{compId}/panels/{panel}/activeContext → güncel sporcu
 * - competitions/{compId}/results → yayınlanan puanlar
 * - Sporcu adı, kulüp, E/D/T/H/S/P, toplam skor gösterimi
 * - Tam ekran modu desteği
 * - Firebase onValue ile gerçek zamanlı güncelleme
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, get } from 'firebase/database';
import { db } from '../lib/firebase';

export default function ScoreboardPage() {
    const [params] = useSearchParams();
    const compId = params.get('comp') || localStorage.getItem('tra_active_comp');
    const panel  = params.get('panel') || 'A';

    const [compName, setCompName] = useState('');
    const [activeCtx, setActiveCtx] = useState(null);
    const [liveScore, setLiveScore] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [connected, setConnected] = useState(false);
    const [lastPublished, setLastPublished] = useState(null); // son yayınlanan sonuç

    const containerRef = useRef(null);

    // ── Firebase Dinleyicileri ─────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;

        // Yarışma adı
        get(ref(db, `competitions/${compId}/name`)).then(snap => {
            if (snap.exists()) setCompName(snap.val());
        });

        setConnected(true);

        // Aktif bağlam (hangi sporcu sahada)
        const ctxUnsub = onValue(
            ref(db, `live/${compId}/panels/${panel}/activeContext`),
            snap => setActiveCtx(snap.val() || null)
        );

        // Canlı skor veya yayınlanmış skor
        const liveUnsub = onValue(
            ref(db, `live/${compId}/scores/current`),
            snap => { if (snap.exists()) setLiveScore(snap.val()); }
        );

        // Tüm sonuçlar → son yayınlananı bul
        const resUnsub = onValue(
            ref(db, `competitions/${compId}/results`),
            snap => {
                const all = snap.val();
                if (!all) return;
                // En son yayınlanan sonucu bul
                let latest = null;
                let latestTs = 0;
                Object.values(all).forEach(athRes => {
                    Object.values(athRes).forEach(r => {
                        if (r && r.timestamp > latestTs) {
                            latestTs = r.timestamp;
                            latest = r;
                        }
                    });
                });
                if (latest) setLastPublished(latest);
            }
        );

        return () => { ctxUnsub(); liveUnsub(); resUnsub(); };
    }, [compId, panel]);

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }

    const athlete = activeCtx?.current;
    const routine = activeCtx?.routine;

    // liveScore: CJP'nin yayınladığı son puan (live/{compId}/scores/current)
    // Bu veri doğrudan kullanılır — athleteId eşleşmesi gerekmez
    // (lastPublished'ın athleteId alanı kaydedilmediğinden eşleşme yapılamıyor)
    const hasScore = liveScore && liveScore.total !== undefined && liveScore.total !== null;
    const currentResult = hasScore ? liveScore : null;

    return (
        <div
            ref={containerRef}
            style={{
                height: '100vh',
                background: 'radial-gradient(circle at top right, #1e293b 0%, #0f172a 60%, #020617 100%)',
                overflow: 'hidden',
                display: 'grid',
                gridTemplateRows: '80px 1fr 100px',
                padding: 20,
                boxSizing: 'border-box',
                gap: 20,
                fontFamily: "'Outfit', sans-serif",
            }}
        >
            {/* ── HEADER ─────────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0 30px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(10px)',
            }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {compName || 'TCF TRAMBOLİN'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                        width: 12, height: 12, borderRadius: '50%',
                        background: connected ? '#10b981' : '#ef4444',
                        boxShadow: connected ? '0 0 10px #10b981' : '0 0 10px #ef4444',
                    }} />
                    <button
                        onClick={toggleFullscreen}
                        style={{
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                            color: 'white', padding: 8, borderRadius: 8, cursor: 'pointer',
                            display: 'flex', alignItems: 'center',
                        }}
                    >
                        <i className="material-icons-round">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</i>
                    </button>
                </div>
            </div>

            {/* ── HERO ───────────────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 30, height: '100%' }}>

                {/* Sol: Sporcu Bilgisi */}
                <div style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 16, display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 40,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                }}>
                    {athlete ? (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 30 }}>
                                <div style={{
                                    background: 'white', color: 'black', fontWeight: 800,
                                    padding: '5px 16px', borderRadius: 6, fontSize: '2rem',
                                    boxShadow: '0 5px 15px rgba(0,0,0,0.2)',
                                }}>
                                    {athlete.noc || (athlete.club ? athlete.club.substring(0, 3).toUpperCase() : '---')}
                                </div>
                                <div style={{
                                    background: 'linear-gradient(135deg, #FFD700, #FDB931)',
                                    color: '#000', fontWeight: 900, padding: '5px 14px',
                                    borderRadius: 6, fontSize: '1.6rem',
                                    boxShadow: '0 0 15px rgba(253,185,49,0.4)',
                                }}>
                                    R{routine || '?'}
                                </div>
                            </div>
                            <div style={{ fontSize: '5.5rem', fontWeight: 900, color: '#fff', textTransform: 'uppercase', lineHeight: 0.9, textShadow: '0 4px 15px rgba(0,0,0,0.8)', marginBottom: 10 }}>
                                {athlete.isPair
                                    ? (athlete.pairName || athlete.displayName || '')
                                    : (athlete.surname || '')}
                            </div>
                            <div style={{ fontSize: '3rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase', marginBottom: 28, textShadow: '0 2px 5px rgba(0,0,0,0.5)' }}>
                                {athlete.isPair ? '' : (athlete.name || athlete.displayName || '')}
                            </div>
                            <div style={{ fontSize: '1.8rem', color: '#38BDF8', fontWeight: 500 }}>
                                {athlete.club || ''}
                            </div>
                        </>
                    ) : (
                        <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '2rem', fontWeight: 700 }}>
                            SPORCU BEKLENİYOR
                        </div>
                    )}
                </div>

                {/* Sağ: Skor Paneli */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
                    {hasScore ? (
                        <>
                            {/* Skor Kutuları */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 15 }}>
                                <ScoreBox label="D" value={currentResult.d?.toFixed(1)} accent="#f59e0b" />
                                <ScoreBox label="E" value={currentResult.e?.toFixed(2)} accent="#10b981" />
                                {currentResult.isPair
                                    ? <ScoreBox label="S" value={currentResult.s?.toFixed(2)} accent="#c084fc" />
                                    : <ScoreBox label="T" value={currentResult.t?.toFixed(3)} accent="#38bdf8" />
                                }
                                <ScoreBox label="H" value={currentResult.h?.toFixed(2)} accent="#a855f7" />
                            </div>

                            {/* Toplam */}
                            <div style={{
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 16, padding: '30px 40px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}>
                                <div style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>TOPLAM SKOR</div>
                                <div style={{
                                    fontFamily: "'Space Mono', monospace",
                                    fontSize: '5rem', fontWeight: 900, color: 'white',
                                    textShadow: '0 0 40px rgba(56,189,248,0.4)',
                                }}>
                                    {currentResult.total?.toFixed(3)}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{
                            background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)',
                            borderRadius: 16, padding: 60, textAlign: 'center',
                            color: 'rgba(255,255,255,0.2)', fontSize: '1.5rem', fontWeight: 700,
                        }}>
                            {athlete ? 'PUAN BEKLENİYOR...' : 'BEKLEME EKRANI'}
                        </div>
                    )}
                </div>
            </div>

            {/* ── FOOTER ─────────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
            }}>
                <div style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }}>
                    TCF — TÜRKİYE CİMNASTİK FEDERASYONU
                </div>
            </div>
        </div>
    );
}

function ScoreBox({ label, value, accent }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12, padding: 16, textAlign: 'center',
        }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: accent, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>{label}</div>
            <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '2.2rem', fontWeight: 700, color: 'white',
            }}>{value ?? '—'}</div>
        </div>
    );
}
