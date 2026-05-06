/**
 * ScoreboardPage.jsx
 * TV / Projeksiyon seyirci ekranı — gerçek zamanlı puan gösterimi
 *
 * Firebase yolları (DÜZELTİLDİ — panel-spesifik):
 *   live/{compId}/panels/{panel}/activeContext → aktif sporcu
 *   live/{compId}/panels/{panel}/scores/current → CJP canlı/yayınlanan puan
 *
 * Skor kutuları:
 *   Bireysel: D  E  T  H
 *   Senkronize: D  E  S  H   (T devre dışı, S×2 toplama eklenir)
 *
 * Tespit: isPair flag VEYA (s > 0 && t === 0) → sync modda göster
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, get } from 'firebase/database';
import { db } from '../lib/firebase';

export default function ScoreboardPage() {
    const [params] = useSearchParams();
    const compId = params.get('comp') || localStorage.getItem('tra_active_comp');
    const panel   = params.get('panel') || 'A';

    const [compName,    setCompName]    = useState('');
    const [activeCtx,   setActiveCtx]   = useState(null);
    const [liveScore,   setLiveScore]   = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [connected,   setConnected]   = useState(false);
    const [scoreReveal, setScoreReveal] = useState(false); // flash animasyonu

    const prevTotalRef  = useRef(null);
    const containerRef  = useRef(null);
    const flashTimerRef = useRef(null);

    // ── Firebase ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;

        get(ref(db, `competitions/${compId}/name`)).then(snap => {
            if (snap.exists()) setCompName(snap.val());
        });

        setConnected(true);

        // Aktif bağlam (sahaya çağrılan sporcu)
        const ctxUnsub = onValue(
            ref(db, `live/${compId}/panels/${panel}/activeContext`),
            snap => setActiveCtx(snap.val() || null)
        );

        // CJP canlı / yayınlanan puan — DÜZELTİLDİ: panel-spesifik yol
        const scoreUnsub = onValue(
            ref(db, `live/${compId}/panels/${panel}/scores/current`),
            snap => {
                if (snap.exists()) {
                    const data = snap.val();
                    // Toplam puan değişince flash animasyonu tetikle
                    if (data.total !== undefined && data.total !== prevTotalRef.current) {
                        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                        setScoreReveal(true);
                        flashTimerRef.current = setTimeout(() => setScoreReveal(false), 2000);
                        prevTotalRef.current = data.total;
                    }
                    setLiveScore(data);
                } else {
                    setLiveScore(null);
                    prevTotalRef.current = null;
                }
            }
        );

        return () => {
            ctxUnsub();
            scoreUnsub();
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        };
    }, [compId, panel]);

    // ── Fullscreen ─────────────────────────────────────────────────────────
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }

    // ── Veri türetme ───────────────────────────────────────────────────────
    const athlete = activeCtx?.current;
    const routine = activeCtx?.routine;

    // Skor verisi var mı?
    const hasScore = liveScore && liveScore.total != null;
    const result   = hasScore ? liveScore : null;

    // Sync tespiti — katman katman: liveScore → athlete → catType
    const isSync = !!(
        result?.isPair === true ||
        (result && result.s > 0 && (result.t === 0 || result.t == null)) ||
        athlete?.isPair === true ||
        athlete?.catType === 'sync'
    );

    // Yayınlandı mı yoksa canlı mı?
    const isPublished = result?.status === 'published';

    // Sporcu adı gösterimi
    const athleteSurname   = athlete ? (
        athlete.isPair || isSync
            ? (athlete.pairName || athlete.displayName || '')
            : (athlete.surname || '')
    ) : '';
    const athleteFirstName = (athlete && !athlete.isPair && !isSync)
        ? (athlete.name || '')
        : '';

    // H değeri (her iki modda da gösterilir)
    const hVal    = result?.h  ?? null;
    const h1Val   = result?.h1 ?? null;
    const h2Val   = result?.h2 ?? null;
    const showH1H2 = isSync && h1Val != null && h2Val != null;

    return (
        <div
            ref={containerRef}
            style={{
                height: '100vh',
                background: 'radial-gradient(circle at top right, #1e293b 0%, #0f172a 60%, #020617 100%)',
                overflow: 'hidden',
                display: 'grid',
                gridTemplateRows: '72px 1fr 72px',
                padding: 20,
                boxSizing: 'border-box',
                gap: 16,
                fontFamily: "'Outfit', sans-serif",
            }}
        >
            {/* ── HEADER ──────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0 28px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(10px)',
            }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 2 }}>
                    {compName || 'TCF TRAMBOLİN'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {/* Panel göstergesi */}
                    <div style={{
                        background: 'rgba(56,189,248,0.12)', color: '#38bdf8',
                        padding: '4px 14px', borderRadius: 6, fontSize: '0.85rem', fontWeight: 700,
                        border: '1px solid rgba(56,189,248,0.25)',
                    }}>
                        PANEL {panel}
                    </div>
                    {/* Bağlantı göstergesi */}
                    <div style={{
                        width: 11, height: 11, borderRadius: '50%',
                        background: connected ? '#10b981' : '#ef4444',
                        boxShadow: connected ? '0 0 10px #10b981' : '0 0 10px #ef4444',
                    }} />
                    <button
                        onClick={toggleFullscreen}
                        style={{
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                            color: 'white', padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                            display: 'flex', alignItems: 'center',
                        }}
                    >
                        <i className="material-icons-round">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</i>
                    </button>
                </div>
            </div>

            {/* ── HERO ─────────────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20, minHeight: 0 }}>

                {/* Sol: Sporcu Kartı */}
                <div style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 20, display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', alignItems: 'center', textAlign: 'center',
                    padding: '32px 28px', boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
                    position: 'relative', overflow: 'hidden',
                }}>
                    {/* Arka plan dekor */}
                    <div style={{
                        position: 'absolute', inset: 0, opacity: 0.04,
                        background: 'repeating-linear-gradient(45deg, white, white 1px, transparent 1px, transparent 20px)',
                        pointerEvents: 'none',
                    }} />

                    {athlete ? (
                        <>
                            {/* Üst etiketler: NOC + Seri */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, zIndex: 1 }}>
                                <div style={{
                                    background: 'white', color: 'black', fontWeight: 900,
                                    padding: '4px 14px', borderRadius: 6, fontSize: '1.6rem',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                    letterSpacing: 1,
                                }}>
                                    {athlete.noc || (athlete.club ? athlete.club.substring(0, 3).toUpperCase() : '---')}
                                </div>
                                <div style={{
                                    background: 'linear-gradient(135deg, #FFD700, #FDB931)',
                                    color: '#000', fontWeight: 900, padding: '4px 12px',
                                    borderRadius: 6, fontSize: '1.4rem',
                                    boxShadow: '0 0 15px rgba(253,185,49,0.45)',
                                }}>
                                    R{routine || '?'}
                                </div>
                                {isSync && (
                                    <div style={{
                                        background: 'rgba(192,132,252,0.2)', color: '#c084fc',
                                        border: '1px solid rgba(192,132,252,0.4)',
                                        padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700,
                                    }}>
                                        <i className="material-icons-round" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 3 }}>sync</i>
                                        SENKRONİZE
                                    </div>
                                )}
                            </div>

                            {/* Sporcu adı */}
                            <div style={{
                                fontSize: athlete.isPair || isSync ? '3.8rem' : '5rem',
                                fontWeight: 900, color: '#fff', textTransform: 'uppercase',
                                lineHeight: 0.95, textShadow: '0 4px 20px rgba(0,0,0,0.8)',
                                marginBottom: 8, zIndex: 1, wordBreak: 'break-word',
                            }}>
                                {athleteSurname}
                            </div>
                            {athleteFirstName && (
                                <div style={{
                                    fontSize: '2.6rem', fontWeight: 700, color: '#e2e8f0',
                                    textTransform: 'uppercase', marginBottom: 20,
                                    textShadow: '0 2px 8px rgba(0,0,0,0.5)', zIndex: 1,
                                }}>
                                    {athleteFirstName}
                                </div>
                            )}

                            {/* Kulüp */}
                            <div style={{
                                fontSize: '1.5rem', color: '#38BDF8', fontWeight: 600,
                                marginTop: athleteFirstName ? 0 : 16, zIndex: 1,
                            }}>
                                {athlete.club || ''}
                            </div>
                        </>
                    ) : (
                        <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: '1.8rem', fontWeight: 700 }}>
                            <i className="material-icons-round" style={{ fontSize: 48, display: 'block', marginBottom: 12, opacity: 0.3 }}>person</i>
                            SPORCU BEKLENİYOR
                        </div>
                    )}
                </div>

                {/* Sağ: Skor Paneli */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>

                    {hasScore ? (
                        <>
                            {/* Durum etiketi */}
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <div style={{
                                    padding: '4px 14px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 800,
                                    letterSpacing: 2, textTransform: 'uppercase',
                                    background: isPublished ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                    color: isPublished ? '#4ade80' : '#f87171',
                                    border: `1px solid ${isPublished ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                                }}>
                                    <i className="material-icons-round" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4 }}>
                                        {isPublished ? 'check_circle' : 'fiber_manual_record'}
                                    </i>
                                    {isPublished ? 'YAYINLANDI' : 'CANLI'}
                                </div>
                                {result?.athleteName && (
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{result.athleteName}</div>
                                )}
                            </div>

                            {/* Skor kutuları */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flex: '0 0 auto' }}>
                                <ScoreBox label="D" value={result.d?.toFixed(1)} accent="#f59e0b" />
                                <ScoreBox label="E" value={result.e?.toFixed(2)} accent="#10b981" />
                                {isSync
                                    ? <ScoreBox label="S" value={result.sRaw != null ? result.sRaw.toFixed(2) : result.s?.toFixed(2)} accent="#c084fc" sublabel="×2" />
                                    : <ScoreBox label="T" value={result.t?.toFixed(3)} accent="#38bdf8" />
                                }
                                {showH1H2 ? (
                                    <ScoreBoxDouble label="H" v1={h1Val?.toFixed(2)} v2={h2Val?.toFixed(2)} accent="#a855f7" />
                                ) : (
                                    <ScoreBox label="H" value={hVal?.toFixed(2)} accent="#a855f7" />
                                )}
                            </div>

                            {/* P / DP kesintiler (varsa) */}
                            {(result.p > 0 || result.dp > 0) && (
                                <div style={{ display: 'flex', gap: 10 }}>
                                    {result.p > 0 && (
                                        <div style={{
                                            padding: '6px 16px', borderRadius: 8,
                                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                                            color: '#f87171', fontSize: '0.9rem', fontWeight: 700,
                                            fontFamily: "'Space Mono', monospace",
                                        }}>
                                            P − {result.p.toFixed(1)}
                                        </div>
                                    )}
                                    {result.dp > 0 && (
                                        <div style={{
                                            padding: '6px 16px', borderRadius: 8,
                                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                                            color: '#f87171', fontSize: '0.9rem', fontWeight: 700,
                                            fontFamily: "'Space Mono', monospace",
                                        }}>
                                            DP − {result.dp.toFixed(1)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Toplam puan — büyük kutu */}
                            <div style={{
                                flex: 1,
                                background: scoreReveal
                                    ? 'rgba(56,189,248,0.12)'
                                    : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${scoreReveal ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)'}`,
                                borderRadius: 20, padding: '24px 36px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                transition: 'background 0.4s, border-color 0.4s',
                                boxShadow: scoreReveal ? '0 0 40px rgba(56,189,248,0.2)' : 'none',
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
                                        TOPLAM PUAN
                                    </div>
                                    {result?.routine && (
                                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                            {result.routine}. Seri
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    fontFamily: "'Space Mono', monospace",
                                    fontSize: '5.5rem', fontWeight: 900, color: 'white',
                                    textShadow: scoreReveal
                                        ? '0 0 60px rgba(56,189,248,0.7)'
                                        : '0 0 30px rgba(56,189,248,0.2)',
                                    transition: 'text-shadow 0.4s',
                                    letterSpacing: -2,
                                }}>
                                    {result.total?.toFixed(3)}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{
                            flex: 1,
                            background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)',
                            borderRadius: 20, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            color: 'rgba(255,255,255,0.15)', fontSize: '1.3rem', fontWeight: 700,
                            gap: 16,
                        }}>
                            <i className="material-icons-round" style={{ fontSize: 52, opacity: 0.2 }}>
                                {athlete ? 'hourglass_empty' : 'tv'}
                            </i>
                            {athlete ? 'PUAN BEKLENİYOR...' : 'BEKLEME EKRANI'}
                        </div>
                    )}
                </div>
            </div>

            {/* ── FOOTER ──────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
            }}>
                <div style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' }}>
                    TCF — TÜRKİYE CİMNASTİK FEDERASYONU
                </div>
            </div>
        </div>
    );
}

// ── Skor Kutusu ──────────────────────────────────────────────────────────────
function ScoreBox({ label, value, accent, sublabel }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '14px 10px', textAlign: 'center',
        }}>
            <div style={{
                fontSize: '0.7rem', fontWeight: 800, color: accent,
                letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            }}>
                {label}
                {sublabel && <span style={{ fontSize: '0.58rem', opacity: 0.7 }}>{sublabel}</span>}
            </div>
            <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '2rem', fontWeight: 700, color: 'white',
                lineHeight: 1,
            }}>
                {value ?? '—'}
            </div>
        </div>
    );
}

// ── Çift H Kutusu (Sync H1 + H2) ─────────────────────────────────────────────
function ScoreBoxDouble({ label, v1, v2, accent }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '10px 10px', textAlign: 'center',
        }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: accent, letterSpacing: 2, marginBottom: 4, textTransform: 'uppercase' }}>
                {label}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: '0.5rem', color: '#64748b', marginBottom: 1 }}>H1</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '1.3rem', fontWeight: 700, color: 'white' }}>{v1 ?? '—'}</div>
                </div>
                <div style={{ color: '#475569', fontSize: '1rem' }}>·</div>
                <div>
                    <div style={{ fontSize: '0.5rem', color: '#64748b', marginBottom: 1 }}>H2</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '1.3rem', fontWeight: 700, color: 'white' }}>{v2 ?? '—'}</div>
                </div>
            </div>
        </div>
    );
}
