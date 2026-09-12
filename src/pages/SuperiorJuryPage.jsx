/**
 * SuperiorJuryPage.jsx
 * Üst Jüri ekranı — sahadaki sporcunun tüm ayrıntısını canlı gösterir.
 *
 * Salt okunur: hiçbir şey yazmaz, hiçbir şeyi değiştirmez. Amacı üst jürinin
 * puanlamayı anlık takip edebilmesi.
 *
 * Firebase yolları (hepsi onValue ile canlı):
 *   competitions/{compId}                        → sporcu, kategori, çift, jüri
 *   competitions/{compId}/results                → yayınlanmış seriler
 *   live/{compId}/panels/{panel}/activeContext   → sahadaki sporcu, seri, hareket
 *   live/{compId}/panels/{panel}/scores/judges   → hakemlerin anlık notları
 *   live/{compId}/panels/{panel}/scores/preview  → CJP'nin girdiği T/H/S/P/DP
 *
 * E skoru CJP ile AYNI fonksiyondan (calcEScore) hesaplanır; ekranda görünen
 * sayı ile yayınlanan sayı ayrışmasın.
 */

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    getAthleteName, getAthleteClub, getPairDisplayName,
    calcEScore, getDScoreFromJudge, formatResultScore, isDNX,
} from '../lib/DataService';

const E_JUDGES = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];

export default function SuperiorJuryPage() {
    const [params] = useSearchParams();
    const compId = params.get('comp') || localStorage.getItem('tra_active_comp');
    const panel  = params.get('panel') || 'A';

    const [compName,   setCompName]   = useState('');
    const [athletes,   setAthletes]   = useState({});
    const [pairs,      setPairs]      = useState({});
    const [members,    setMembers]    = useState({});
    const [results,    setResults]    = useState({});
    const [ctx,        setCtx]        = useState(null);
    const [judges,     setJudges]     = useState({});
    const [preview,    setPreview]    = useState(null);
    const [connected,  setConnected]  = useState(false);

    // ── Canlı bağlantılar ─────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;
        const unsubs = [];

        unsubs.push(onValue(ref(db, `competitions/${compId}/name`), s => setCompName(s.val() || '')));
        unsubs.push(onValue(ref(db, `competitions/${compId}/athletes`), s => setAthletes(s.val() || {})));
        unsubs.push(onValue(ref(db, `competitions/${compId}/pairs`), s => setPairs(s.val() || {})));
        unsubs.push(onValue(ref(db, `competitions/${compId}/juryPanels/${panel}/members`), s => setMembers(s.val() || {})));
        unsubs.push(onValue(ref(db, `competitions/${compId}/results`), s => setResults(s.val() || {})));
        unsubs.push(onValue(ref(db, `live/${compId}/panels/${panel}/activeContext`), s => {
            setCtx(s.val() || null);
            setConnected(true);
        }));
        unsubs.push(onValue(ref(db, `live/${compId}/panels/${panel}/scores/judges`), s => setJudges(s.val() || {})));
        unsubs.push(onValue(ref(db, `live/${compId}/panels/${panel}/scores/preview`), s => setPreview(s.val() || null)));

        return () => {
            setConnected(false);
            unsubs.forEach(u => u && u());
        };
    }, [compId, panel]);

    // ── Sahadaki sporcu ───────────────────────────────────────────────────
    const onField      = ctx?.current || null;
    const athleteId    = onField?.uniqueId || onField?.id || null;
    const routine      = ctx?.routine ?? null;
    const elementCount = Number(ctx?.elementCount) || 10;

    // Sporcunun tam kaydı (activeContext anlık görüntüsünde eksik alan olabilir)
    const fullAthlete = athleteId ? (athletes[athleteId] || onField) : null;
    const pair        = onField?.pairId ? pairs[onField.pairId] : null;
    const isSync      = !!(onField?.isPair || onField?.catType === 'sync' || pair);

    const displayName = pair
        ? getPairDisplayName(pair, athletes)
        : (onField ? getAthleteName(fullAthlete || onField) : '');

    // Çift üyeleri — ikisinin de bilgisi ayrı ayrı gösterilir
    const pairMembers = useMemo(() => {
        if (!pair) return [];
        return [pair.athlete1Id, pair.athlete2Id].map(id => athletes[id]).filter(Boolean);
    }, [pair, athletes]);

    // ── Puanlar ───────────────────────────────────────────────────────────
    const eScore    = calcEScore(judges, elementCount, isSync);
    const dFromJudge = getDScoreFromJudge(judges);
    const athResults = athleteId ? (results[athleteId] || {}) : {};

    // CJP'nin anlık girdileri (yayınlanmadan önce). Sahadaki sporcuya ait mi
    // diye kontrol edilir — eski bir sporcunun önizlemesi gösterilmesin.
    const livePreview = preview && preview.athleteId === athleteId ? preview : null;

    if (!compId) {
        return <Centered>Yarışma seçilmemiş. Bu ekranı Panel üzerinden açın.</Centered>;
    }

    return (
        <div style={{
            minHeight: '100vh', background: '#0b1120', color: '#e2e8f0',
            fontFamily: "'Outfit', sans-serif", padding: 'clamp(10px, 1.6vw, 20px)',
            boxSizing: 'border-box',
        }}>
            {/* ── Başlık ──────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '10px 18px', marginBottom: 14, gap: 12, flexWrap: 'wrap',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{
                        width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                        background: connected ? '#4ade80' : '#64748b',
                        boxShadow: connected ? '0 0 10px #4ade80' : 'none',
                    }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.7rem', letterSpacing: 2, color: '#64748b', fontWeight: 700 }}>
                            ÜST JÜRİ
                        </div>
                        <div style={{
                            fontWeight: 700, fontSize: '1.05rem',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {compName || '—'}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip label="PANEL" value={panel} />
                    <Chip label="SERİ" value={routine ? `${routine}.` : '—'} />
                    <Chip label="HAREKET" value={elementCount} />
                </div>
            </div>

            {!onField ? (
                <Centered>Sahada sporcu yok — başhakem sporcu çağırdığında burada görünecek.</Centered>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 14, alignItems: 'start' }}>

                    {/* ── SOL: Sporcu bilgileri ──────────────────────── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <Card title="SAHADAKİ SPORCU" accent="#7C87D8">
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
                                {displayName || '—'}
                            </div>
                            <div style={{ color: '#7C87D8', fontWeight: 600, marginTop: 4 }}>
                                {getAthleteClub(fullAthlete || onField) || '—'}
                            </div>
                            {isSync && (
                                <span style={{
                                    display: 'inline-block', marginTop: 8,
                                    background: 'rgba(192,132,252,0.15)', color: '#c084fc',
                                    border: '1px solid rgba(192,132,252,0.4)',
                                    padding: '2px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700,
                                }}>
                                    SENKRONİZE
                                </span>
                            )}

                            <Divider />
                            <Row label="Kategori"   value={onField.catName || '—'} />
                            <Row label="Göğüs No"   value={fullAthlete?.bib || '—'} />
                            <Row label="Doğum T."   value={fullAthlete?.dob || '—'} />
                            <Row label="Sporcu ID"  value={athleteId} mono />
                        </Card>

                        {/* Senkron çiftin üyeleri */}
                        {pairMembers.length > 0 && (
                            <Card title="ÇİFT ÜYELERİ" accent="#c084fc">
                                {pairMembers.map(m => (
                                    <div key={m.id} style={{ marginBottom: 10 }}>
                                        <div style={{ fontWeight: 700, color: '#fff' }}>{getAthleteName(m)}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                            {getAthleteClub(m) || '—'}
                                            {m.bib ? ` · Göğüs No ${m.bib}` : ''}
                                        </div>
                                    </div>
                                ))}
                            </Card>
                        )}

                        {/* Bu sporcunun yayınlanmış serileri */}
                        <Card title="YAYINLANMIŞ SERİLER" accent="#10b981">
                            {[1, 2].map(r => {
                                const res = athResults[`r${r}`];
                                return (
                                    <div key={r} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '8px 0',
                                        borderBottom: r === 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                                    }}>
                                        <span style={{ color: '#94a3b8', fontWeight: 600 }}>{r}. Seri</span>
                                        {res ? (
                                            <span style={{
                                                fontFamily: "'Space Mono', monospace", fontWeight: 700,
                                                color: isDNX(res.status) ? '#fca5a5' : '#10b981', fontSize: '1.1rem',
                                            }}>
                                                {formatResultScore(res.total, res.status, '—')}
                                            </span>
                                        ) : (
                                            <span style={{ color: '#475569' }}>Yayınlanmadı</span>
                                        )}
                                    </div>
                                );
                            })}
                        </Card>

                        {/* Panelin hakem kadrosu */}
                        <Card title="PANEL HAKEMLERİ" accent="#f59e0b">
                            {[['cjp', 'CJP'], ['d1', 'D'], ...E_JUDGES.map(e => [e, e.toUpperCase()])].map(([key, label]) => (
                                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
                                    <span style={{ color: '#64748b', fontWeight: 700, minWidth: 42 }}>{label}</span>
                                    <span style={{ color: members[key] ? '#e2e8f0' : '#475569', textAlign: 'right' }}>
                                        {members[key] || '—'}
                                    </span>
                                </div>
                            ))}
                        </Card>
                    </div>

                    {/* ── SAĞ: Puan ayrıntısı ────────────────────────── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                        {/* Anlık skor kutuları */}
                        <Card title="ANLIK PUAN" accent="#E02828">
                            {livePreview?.status && (
                                <div style={{
                                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                                    color: '#fca5a5', borderRadius: 8, padding: '6px 12px',
                                    fontWeight: 700, marginBottom: 12, textAlign: 'center',
                                }}>
                                    DURUM: {String(livePreview.status).toUpperCase()}
                                </div>
                            )}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8,
                            }}>
                                <Stat label="E" value={eScore.toFixed(2)} big />
                                <Stat label="D" value={(dFromJudge ?? livePreview?.d ?? 0).toFixed(1)} />
                                {isSync
                                    ? <Stat label="S" value={(livePreview?.s ?? 0).toFixed(2)} />
                                    : <Stat label="T" value={(livePreview?.t ?? 0).toFixed(3)} />}
                                <Stat label="H" value={(livePreview?.h ?? 0).toFixed(2)} />
                                <Stat label="P" value={(livePreview?.p ?? 0).toFixed(1)} neg />
                                <Stat label="DP" value={(livePreview?.dp ?? 0).toFixed(1)} neg />
                                <Stat label="TOPLAM" value={(livePreview?.total ?? 0).toFixed(3)} big accent="#10b981" />
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 10 }}>
                                E skoru hakem notlarından anlık hesaplanır. Diğer değerler başhakem
                                giriş yaptıkça güncellenir; yayınlanana kadar değişebilir.
                            </div>
                        </Card>

                        {/* Hakem notları — eleman eleman */}
                        <Card title="HAKEM NOTLARI" accent="#3b82f6">
                            <JudgeMatrix judges={judges} elementCount={elementCount} members={members} />
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Hakem matrisi ────────────────────────────────────────────────────────
 * Her E hakeminin eleman eleman kesintileri. Sütun içindeki en yüksek ve en
 * düşük değer işaretlenir (FIG'de bunlar elenir), sağda hakemin toplamı ve
 * geçerli toplamdan sapması görünür.
 */
function JudgeMatrix({ judges, elementCount, members }) {
    const active = E_JUDGES.filter(j => judges[j]);
    if (active.length === 0) {
        return <div style={{ color: '#475569', padding: '10px 0' }}>Henüz hakem notu gelmedi.</div>;
    }

    // Sütun istatistikleri (min/max işaretlemek için)
    const colStats = [];
    for (let i = 0; i < elementCount; i++) {
        const vals = active
            .map(j => judges[j]?.deductions?.[i])
            .filter(v => v !== undefined && v !== null)
            .map(Number);
        colStats.push(vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: null, max: null });
    }

    const judgeTotal = (j) => {
        const d = judges[j];
        const arr = d?.deductions || d?.scores || [];
        const sum = arr.slice(0, elementCount).reduce((a, b) => a + (Number(b) || 0), 0);
        return sum + (Number(d?.landing) || 0);
    };
    const totals = active.map(judgeTotal);
    const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;

    const cell = {
        textAlign: 'center', padding: '6px 4px', fontSize: '0.8rem',
        fontFamily: "'Space Mono', monospace",
        borderBottom: '1px solid rgba(255,255,255,0.05)',
    };

    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
                <thead>
                    <tr>
                        <th style={{ ...cell, textAlign: 'left', color: '#64748b', fontSize: '0.7rem' }}>HAKEM</th>
                        {Array.from({ length: elementCount }, (_, i) => (
                            <th key={i} style={{ ...cell, color: '#64748b', fontSize: '0.7rem' }}>{i + 1}</th>
                        ))}
                        <th style={{ ...cell, color: '#64748b', fontSize: '0.7rem' }}>L</th>
                        <th style={{ ...cell, color: '#94a3b8', fontSize: '0.7rem' }}>TOPLAM</th>
                        <th style={{ ...cell, color: '#94a3b8', fontSize: '0.7rem' }}>SAPMA</th>
                    </tr>
                </thead>
                <tbody>
                    {active.map((j, idx) => {
                        const d = judges[j];
                        const arr = d?.deductions || d?.scores || [];
                        const tot = totals[idx];
                        const dev = tot - avgTotal;
                        return (
                            <tr key={j}>
                                <td style={{ ...cell, textAlign: 'left', fontFamily: "'Outfit', sans-serif" }}>
                                    <div style={{ fontWeight: 800, color: d?.submitted ? '#10b981' : '#eab308' }}>
                                        {j.toUpperCase()}
                                    </div>
                                    <div style={{
                                        fontSize: '0.68rem', color: '#64748b',
                                        maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {members[j] || '—'}
                                    </div>
                                </td>
                                {Array.from({ length: elementCount }, (_, i) => {
                                    const v = arr[i];
                                    const num = v === undefined || v === null ? null : Number(v);
                                    const cs = colStats[i];
                                    let bg = 'transparent';
                                    if (num !== null && cs.min !== null && cs.min !== cs.max) {
                                        if (num === cs.max) bg = 'rgba(239,68,68,0.22)';   // elenecek yüksek
                                        else if (num === cs.min) bg = 'rgba(59,130,246,0.22)'; // elenecek düşük
                                    }
                                    return (
                                        <td key={i} style={{ ...cell, background: bg, color: num === null ? '#334155' : '#e2e8f0' }}>
                                            {num === null ? '·' : num.toFixed(1)}
                                        </td>
                                    );
                                })}
                                <td style={{ ...cell, color: '#cbd5e1' }}>
                                    {d?.landing === undefined || d?.landing === null || d?.landing === '' ? '·' : Number(d.landing).toFixed(1)}
                                </td>
                                <td style={{ ...cell, color: '#fff', fontWeight: 700 }}>{tot.toFixed(1)}</td>
                                <td style={{
                                    ...cell,
                                    color: Math.abs(dev) >= 0.3 ? '#f87171' : Math.abs(dev) >= 0.15 ? '#fbbf24' : '#64748b',
                                    fontWeight: 700,
                                }}>
                                    {dev >= 0 ? '+' : ''}{dev.toFixed(1)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: '0.72rem', color: '#64748b', flexWrap: 'wrap' }}>
                <Legend color="rgba(239,68,68,0.5)" text="Sütunun en yükseği (elenir)" />
                <Legend color="rgba(59,130,246,0.5)" text="Sütunun en düşüğü (elenir)" />
                <Legend color="#10b981" text="Gönderdi" />
                <Legend color="#eab308" text="Giriyor" />
            </div>
        </div>
    );
}

/* ── Küçük yardımcı bileşenler ───────────────────────────────────────────── */
function Card({ title, accent, children }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12, padding: 16,
        }}>
            <div style={{
                fontSize: '0.7rem', letterSpacing: 2, fontWeight: 800,
                color: accent, marginBottom: 12,
            }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function Row({ label, value, mono }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: '0.88rem' }}>
            <span style={{ color: '#64748b' }}>{label}</span>
            <span style={{
                color: '#e2e8f0', fontWeight: 600, textAlign: 'right',
                fontFamily: mono ? "'Space Mono', monospace" : 'inherit',
                fontSize: mono ? '0.75rem' : 'inherit',
                overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
                {value}
            </span>
        </div>
    );
}

function Stat({ label, value, big, neg, accent }) {
    return (
        <div style={{
            background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: '10px 8px', textAlign: 'center',
            border: '1px solid rgba(255,255,255,0.06)',
        }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: 1, color: '#64748b', fontWeight: 700 }}>{label}</div>
            <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: big ? '1.6rem' : '1.15rem', fontWeight: 700,
                color: accent || (neg ? '#fca5a5' : '#fff'), marginTop: 2,
            }}>
                {neg && parseFloat(value) > 0 ? '-' : ''}{value}
            </div>
        </div>
    );
}

function Chip({ label, value }) {
    return (
        <div style={{
            background: 'rgba(124,135,216,0.12)', border: '1px solid rgba(124,135,216,0.25)',
            color: '#7C87D8', padding: '4px 12px', borderRadius: 6,
            fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
        }}>
            {label} <strong style={{ color: '#fff' }}>{value}</strong>
        </div>
    );
}

function Divider() {
    return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />;
}

function Legend({ color, text }) {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
            {text}
        </span>
    );
}

function Centered({ children }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '50vh', color: '#475569', fontSize: '1rem', textAlign: 'center', padding: 20,
        }}>
            {children}
        </div>
    );
}
