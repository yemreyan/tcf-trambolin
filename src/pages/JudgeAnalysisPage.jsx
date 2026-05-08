/**
 * JudgeAnalysisPage.jsx
 * judge_analysis.html → React portu
 * Hakem performans raporu: Özet / Hakemler / Matris / Sapma / Kulüpler
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import * as XLSX from 'xlsx';

// ── Yardımcı ────────────────────────────────────────────────────────────────

function calcStdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
}

// ── Ana Bileşen ──────────────────────────────────────────────────────────────

export default function JudgeAnalysisPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const compId = getActiveCompId();

    const [categories, setCategories] = useState({});
    const [allResults, setAllResults]  = useState([]);   // düzleştirilmiş
    const [compName, setCompName]      = useState('');
    const [loading, setLoading]        = useState(false);

    const [catFilter,     setCatFilter]     = useState('');
    const [routineFilter, setRoutineFilter] = useState('');
    const [tab, setTab]                     = useState('summary');

    // ── Veri yükleme ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        loadData();
    }, [compId]);

    async function loadData() {
        setLoading(true);
        try {
            const [catSnap, athSnap, resSnap, nameSnap] = await Promise.all([
                get(ref(db, `competitions/${compId}/categories`)),
                get(ref(db, `competitions/${compId}/athletes`)),
                get(ref(db, `competitions/${compId}/results`)),
                get(ref(db, `competitions/${compId}/name`)),
            ]);

            const cats    = catSnap.val()  || {};
            const athletes = athSnap.val() || {};
            const raw     = resSnap.val()  || {};
            setCategories(cats);
            setCompName(nameSnap.val() || '');

            // Düzleştir
            const flat = [];
            Object.entries(raw).forEach(([athId, routines]) => {
                const ath = athletes[athId] || {};
                ['r1', 'r2'].forEach((rKey, ri) => {
                    const r = routines?.[rKey];
                    if (r?.judges) {
                        flat.push({
                            athId,
                            athleteName: `${ath.name || ''} ${ath.surname || ''}`.trim() || 'Bilinmiyor',
                            club: ath.club || ath.kulup || '',
                            category: ath.category || ath.categoryId || ath.catId || '',
                            routine: ri + 1,
                            judges: r.judges,
                            eScore: r.e || 0,
                        });
                    }
                });
            });
            setAllResults(flat);
        } finally {
            setLoading(false);
        }
    }

    // ── Filtrelenmiş veri ────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        return allResults.filter(r => {
            if (catFilter && r.category !== catFilter) return false;
            if (routineFilter && r.routine !== parseInt(routineFilter)) return false;
            return true;
        });
    }, [allResults, catFilter, routineFilter]);

    // ── Excel export ─────────────────────────────────────────────────────────
    function exportExcel() {
        const rows = filtered.map(r => {
            const row = { 'Sporcu': r.athleteName, 'Kulüp': r.club, 'Seri': r.routine, 'E Skoru': r.eScore };
            for (let j = 1; j <= 6; j++) {
                const jd = r.judges[`e${j}`];
                row[`E${j} Kesinti`] = jd?.deductions
                    ? jd.deductions.reduce((a, b) => a + parseFloat(b || 0), 0).toFixed(2)
                    : '-';
            }
            if (r.judges.d?.val !== undefined) row['D Skoru'] = r.judges.d.val;
            return row;
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Hakem Analizi');
        XLSX.writeFile(wb, `hakem_analizi_${compId}.xlsx`);
    }

    // ── Render ───────────────────────────────────────────────────────────────
    const TABS = [
        { id: 'summary',   icon: 'assessment',       label: 'Özet'     },
        { id: 'judges',    icon: 'people',            label: 'Hakemler' },
        { id: 'matrix',    icon: 'grid_on',           label: 'Matris'   },
        { id: 'deviation', icon: 'show_chart',        label: 'Sapma'    },
        { id: 'clubs',     icon: 'emoji_events',      label: 'Kulüpler' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* Nav */}
            <nav className="topnav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1 }}>
                        HAKEM ANALİZ RAPORU
                    </span>
                </div>
                {compName && (
                    <span style={{ color: 'var(--accent-secondary)', fontWeight: 700 }}>{compName}</span>
                )}
            </nav>

            <div className="container" style={{ maxWidth: 1400 }}>

                {/* Filtre Çubuğu */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
                            <label>Kategori</label>
                            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                                <option value="">Tüm Kategoriler</option>
                                {Object.values(categories).map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group" style={{ margin: 0, minWidth: 150 }}>
                            <label>Seri</label>
                            <select value={routineFilter} onChange={e => setRoutineFilter(e.target.value)}>
                                <option value="">Tümü</option>
                                <option value="1">1. Seri</option>
                                <option value="2">2. Seri</option>
                            </select>
                        </div>
                        <div style={{ marginLeft: 'auto' }}>
                            <button className="btn btn-outline" onClick={exportExcel} disabled={filtered.length === 0}>
                                <i className="material-icons-round">download</i> Excel'e Aktar
                            </button>
                        </div>
                    </div>
                </div>

                {loading && (
                    <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
                        <i className="material-icons-round" style={{ fontSize: 48, display: 'block', marginBottom: 12, opacity: 0.4 }}>hourglass_top</i>
                        Yükleniyor...
                    </div>
                )}

                {!loading && filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
                        <i className="material-icons-round" style={{ fontSize: 48, display: 'block', marginBottom: 12, opacity: 0.3 }}>bar_chart</i>
                        Seçili kriterlere uygun yayınlanmış sonuç bulunamadı.
                    </div>
                )}

                {!loading && filtered.length > 0 && (
                    <div className="card">
                        {/* Sekme Başlıkları */}
                        <div style={{ display: 'flex', gap: 4, padding: '16px 20px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {TABS.map(t => (
                                <button key={t.id} onClick={() => setTab(t.id)} style={{
                                    padding: '10px 18px', border: 'none', borderRadius: '8px 8px 0 0',
                                    cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                                    background: tab === t.id ? 'var(--accent-secondary)' : 'transparent',
                                    color: tab === t.id ? '#000' : '#94a3b8',
                                    display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s',
                                }}>
                                    <i className="material-icons-round" style={{ fontSize: 16 }}>{t.icon}</i>
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        <div className="card-body">
                            {tab === 'summary'   && <SummaryTab   data={filtered} />}
                            {tab === 'judges'    && <JudgesTab    data={filtered} />}
                            {tab === 'matrix'    && <MatrixTab    data={filtered} />}
                            {tab === 'deviation' && <DeviationTab data={filtered} />}
                            {tab === 'clubs'     && <ClubsTab     data={filtered} />}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Sekme: Özet ──────────────────────────────────────────────────────────────

function SummaryTab({ data }) {
    const { stats, topDevs } = useMemo(() => {
        const uniqueAthletes = new Set(data.map(d => d.athId)).size;
        const avgE = data.reduce((s, d) => s + d.eScore, 0) / data.length;

        const allDevs = [];
        data.forEach(result => {
            for (let i = 0; i < 10; i++) {
                const deductions = [];
                for (let j = 1; j <= 6; j++) {
                    const v = result.judges[`e${j}`]?.deductions?.[i];
                    if (v !== undefined) deductions.push(parseFloat(v));
                }
                if (deductions.length >= 4) {
                    const std = calcStdDev(deductions);
                    allDevs.push({ athlete: result.athleteName, routine: result.routine, element: i + 1, deductions, std });
                }
            }
        });

        const avgStd = allDevs.length > 0 ? allDevs.reduce((s, d) => s + d.std, 0) / allDevs.length : 0;
        const consistency = avgStd > 0 ? Math.max(0, 100 - avgStd * 100) : 100;
        const maxDev = allDevs.length > 0 ? Math.max(...allDevs.map(d => d.std)) : 0;
        const outliers = allDevs.filter(d => d.std > 0.3).length;
        const topDevs = [...allDevs].sort((a, b) => b.std - a.std).slice(0, 10);

        return { stats: { uniqueAthletes, avgE, consistency, maxDev, outliers, routines: data.length }, topDevs };
    }, [data]);

    const statCards = [
        { label: 'Sporcu', value: stats.uniqueAthletes, icon: 'person', color: '#38bdf8' },
        { label: 'Seri', value: stats.routines, icon: 'repeat', color: '#38bdf8' },
        { label: 'Ort. E Skoru', value: stats.avgE.toFixed(2), icon: 'speed', color: '#38bdf8' },
        { label: 'Tutarlılık', value: stats.consistency.toFixed(0) + '%', icon: 'verified', color: stats.consistency > 85 ? '#22c55e' : stats.consistency > 70 ? '#f59e0b' : '#ef4444' },
        { label: 'Maks. Sapma', value: stats.maxDev.toFixed(2), icon: 'warning', color: stats.maxDev < 0.2 ? '#22c55e' : stats.maxDev < 0.4 ? '#f59e0b' : '#ef4444' },
        { label: 'Aykırı Karar', value: stats.outliers, icon: 'error_outline', color: stats.outliers === 0 ? '#22c55e' : stats.outliers < 5 ? '#f59e0b' : '#ef4444' },
    ];

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 28 }}>
                {statCards.map(s => (
                    <div key={s.label} style={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10, padding: '16px 12px', textAlign: 'center',
                    }}>
                        <i className="material-icons-round" style={{ fontSize: 22, color: s.color, marginBottom: 6 }}>{s.icon}</i>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>{s.label}</div>
                    </div>
                ))}
            </div>

            <h4 style={{ color: '#94a3b8', marginBottom: 12, fontSize: '0.8rem', letterSpacing: 1 }}>EN YÜKSEK 10 SAPMA</h4>
            <div className="table-responsive">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Sporcu</th><th>Seri</th><th>Element</th>
                            <th>Hakem Kesintileri</th><th>Std Sapma</th>
                        </tr>
                    </thead>
                    <tbody>
                        {topDevs.length === 0 && (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>Sapma verisi yok</td></tr>
                        )}
                        {topDevs.map((d, i) => (
                            <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{d.athlete}</td>
                                <td>{d.routine}. Seri</td>
                                <td>S{d.element}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                    {d.deductions.map(v => v.toFixed(1)).join(' | ')}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 80, height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                                            <div style={{
                                                width: `${Math.min(100, d.std * 200)}%`, height: '100%', borderRadius: 4,
                                                background: d.std < 0.2 ? '#22c55e' : d.std < 0.4 ? '#f59e0b' : '#ef4444',
                                            }} />
                                        </div>
                                        <span style={{ fontFamily: 'monospace', fontWeight: 700,
                                            color: d.std < 0.2 ? '#22c55e' : d.std < 0.4 ? '#f59e0b' : '#ef4444' }}>
                                            {d.std.toFixed(2)}
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Sekme: Hakemler ──────────────────────────────────────────────────────────

function JudgesTab({ data }) {
    const judgeCards = useMemo(() => {
        const stats = {};
        for (let j = 1; j <= 6; j++) stats[`e${j}`] = { name: `E${j} Hakemi`, values: [] };
        stats.d = { name: 'D Hakemi', values: [] };

        data.forEach(r => {
            for (let j = 1; j <= 6; j++) {
                const jd = r.judges[`e${j}`];
                if (jd?.deductions) {
                    const sum = jd.deductions.reduce((a, b) => a + parseFloat(b || 0), 0) + parseFloat(jd.landing || 0);
                    stats[`e${j}`].values.push(sum);
                }
            }
            if (r.judges.d?.val !== undefined) stats.d.values.push(parseFloat(r.judges.d.val));
        });

        const eAvgs = Object.entries(stats).filter(([k]) => k !== 'd' && stats[k].values.length > 0)
            .map(([, s]) => s.values.reduce((a, b) => a + b, 0) / s.values.length);
        const overallAvg = eAvgs.length > 0 ? eAvgs.reduce((a, b) => a + b, 0) / eAvgs.length : 0;

        return Object.entries(stats).map(([key, s]) => {
            if (s.values.length === 0) return null;
            const avg = s.values.reduce((a, b) => a + b, 0) / s.values.length;
            const std = calcStdDev(s.values);
            const min = Math.min(...s.values);
            const max = Math.max(...s.values);
            const bias = key !== 'd' && overallAvg > 0 ? ((avg - overallAvg) / overallAvg * 100) : 0;
            const badge = key === 'd' ? null : bias > 10 ? { text: 'Sert', color: '#ef4444' } : bias < -10 ? { text: 'Yumuşak', color: '#22c55e' } : { text: 'Nötr', color: '#94a3b8' };
            return { key, ...s, avg, std, min, max, bias, badge };
        }).filter(Boolean);
    }, [data]);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {judgeCards.map(jc => (
                <div key={jc.key} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12, padding: 20,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{jc.name}</span>
                        {jc.badge && (
                            <span style={{
                                fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px',
                                borderRadius: 20, background: `${jc.badge.color}22`, color: jc.badge.color,
                            }}>{jc.badge.text}</span>
                        )}
                    </div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, color: jc.key === 'd' ? '#fbbf24' : '#38bdf8', marginBottom: 4 }}>
                        {jc.avg.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 14 }}>
                        Ortalama {jc.key === 'd' ? 'Zorluk' : 'Kesinti'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                        {[['Min', jc.min.toFixed(1)], ['Max', jc.max.toFixed(1)], ['Std', jc.std.toFixed(2)]].map(([l, v]) => (
                            <div key={l} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '6px 4px' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{l}</div>
                                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    {jc.key !== 'd' && (
                        <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#64748b' }}>
                            Sapma: <span style={{ fontWeight: 700, color: jc.bias > 0 ? '#ef4444' : '#22c55e' }}>
                                {jc.bias > 0 ? '+' : ''}{jc.bias.toFixed(1)}%
                            </span>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Sekme: Matris ────────────────────────────────────────────────────────────

function MatrixTab({ data }) {
    const { rows, judgeAvgs } = useMemo(() => {
        const judgeAvgs = {};
        for (let j = 1; j <= 6; j++) {
            const vals = data.flatMap(r => {
                const jd = r.judges[`e${j}`];
                return jd?.deductions ? [jd.deductions.reduce((a, b) => a + parseFloat(b || 0), 0)] : [];
            });
            judgeAvgs[j] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        }
        return { rows: data.slice(0, 60), judgeAvgs };
    }, [data]);

    return (
        <div className="table-responsive">
            <table className="table" style={{ fontSize: '0.82rem' }}>
                <thead>
                    <tr>
                        <th>Sporcu</th><th>Seri</th>
                        {[1,2,3,4,5,6].map(j => <th key={j} style={{ textAlign: 'center' }}>E{j}</th>)}
                        <th style={{ textAlign: 'center' }}>Toplam</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => {
                        let totalDed = 0;
                        const cells = [1,2,3,4,5,6].map(j => {
                            const jd = r.judges[`e${j}`];
                            if (!jd?.deductions) return <td key={j} style={{ textAlign: 'center', color: '#475569' }}>—</td>;
                            const sum = jd.deductions.reduce((a, b) => a + parseFloat(b || 0), 0);
                            totalDed += sum;
                            const diff = sum - judgeAvgs[j];
                            const bg = diff > 0.5 ? 'rgba(239,68,68,0.15)' : diff < -0.5 ? 'rgba(34,197,94,0.15)' : 'transparent';
                            const col = diff > 0.5 ? '#ef4444' : diff < -0.5 ? '#22c55e' : 'inherit';
                            return (
                                <td key={j} style={{ textAlign: 'center', background: bg, color: col, fontWeight: Math.abs(diff) > 0.5 ? 700 : 400 }}>
                                    {sum.toFixed(1)}
                                </td>
                            );
                        });
                        return (
                            <tr key={i}>
                                <td style={{ fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.athleteName}</td>
                                <td style={{ textAlign: 'center' }}>{r.routine}</td>
                                {cells}
                                <td style={{ textAlign: 'center', fontWeight: 700 }}>{totalDed.toFixed(1)}</td>
                            </tr>
                        );
                    })}
                    {data.length > 60 && (
                        <tr><td colSpan={9} style={{ textAlign: 'center', color: '#64748b', padding: 12 }}>
                            ... ve {data.length - 60} seri daha
                        </td></tr>
                    )}
                </tbody>
            </table>
            <div style={{ marginTop: 12, display: 'flex', gap: 20, fontSize: '0.75rem', color: '#64748b' }}>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(239,68,68,0.3)', borderRadius: 2, marginRight: 4 }} />Ortalamadan +0.5 fazla (sert)</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(34,197,94,0.3)', borderRadius: 2, marginRight: 4 }} />Ortalamadan -0.5 az (yumuşak)</span>
            </div>
        </div>
    );
}

// ── Sekme: Sapma ─────────────────────────────────────────────────────────────

function DeviationTab({ data }) {
    const rows = useMemo(() => {
        return [1,2,3,4,5,6].map(j => {
            const vals = data.flatMap(r => {
                const jd = r.judges[`e${j}`];
                return jd?.deductions ? [jd.deductions.reduce((a, b) => a + parseFloat(b || 0), 0)] : [];
            });
            if (vals.length === 0) return null;
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const std = calcStdDev(vals);
            const consistency = std > 0 ? Math.max(0, 100 - std * 20) : 100;
            return { j, avg, std, min: Math.min(...vals), max: Math.max(...vals), consistency };
        }).filter(Boolean);
    }, [data]);

    return (
        <div className="table-responsive">
            <table className="table">
                <thead>
                    <tr>
                        <th>Hakem</th><th>Ort. Kesinti</th><th>Std Sapma</th>
                        <th>Min</th><th>Max</th><th>Tutarlılık</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => {
                        const barColor = r.consistency > 85 ? '#22c55e' : r.consistency > 70 ? '#f59e0b' : '#ef4444';
                        return (
                            <tr key={r.j}>
                                <td style={{ fontWeight: 700 }}>E{r.j} Hakemi</td>
                                <td style={{ fontFamily: 'monospace' }}>{r.avg.toFixed(2)}</td>
                                <td style={{ fontFamily: 'monospace', color: r.std > 0.4 ? '#ef4444' : r.std > 0.2 ? '#f59e0b' : '#22c55e' }}>
                                    {r.std.toFixed(2)}
                                </td>
                                <td style={{ fontFamily: 'monospace' }}>{r.min.toFixed(1)}</td>
                                <td style={{ fontFamily: 'monospace' }}>{r.max.toFixed(1)}</td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 100, height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                                            <div style={{ width: `${r.consistency}%`, height: '100%', borderRadius: 4, background: barColor }} />
                                        </div>
                                        <span style={{ fontWeight: 700, color: barColor }}>{r.consistency.toFixed(0)}%</span>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Sekme: Kulüpler ──────────────────────────────────────────────────────────

function ClubsTab({ data }) {
    const clubs = useMemo(() => {
        const m = {};
        data.forEach(r => {
            const c = r.club || 'Bilinmiyor';
            if (!m[c]) m[c] = [];
            m[c].push(r.eScore);
        });
        const arr = Object.entries(m).map(([club, scores]) => ({
            club,
            avg: scores.reduce((a, b) => a + b, 0) / scores.length,
            count: scores.length,
        })).sort((a, b) => b.avg - a.avg);
        const maxAvg = Math.max(...arr.map(c => c.avg), 20);
        return arr.map(c => ({ ...c, pct: (c.avg / maxAvg) * 100 }));
    }, [data]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {clubs.map((c, i) => (
                <div key={c.club} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 24, textAlign: 'center', fontWeight: 700, color: '#64748b', fontSize: '0.8rem' }}>{i + 1}</div>
                    <div style={{ width: 180, fontWeight: 600, fontSize: '0.9rem', flexShrink: 0 }}>{c.club}</div>
                    <div style={{ flex: 1, height: 28, background: 'rgba(255,255,255,0.05)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{
                            width: `${c.pct}%`, height: '100%', borderRadius: 6,
                            background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
                            display: 'flex', alignItems: 'center', paddingLeft: 10,
                            fontSize: '0.82rem', fontWeight: 700, color: '#000',
                            transition: 'width 0.5s ease',
                        }}>
                            {c.avg.toFixed(2)}
                        </div>
                    </div>
                    <div style={{ width: 70, textAlign: 'right', fontSize: '0.78rem', color: '#64748b' }}>{c.count} seri</div>
                </div>
            ))}
        </div>
    );
}
