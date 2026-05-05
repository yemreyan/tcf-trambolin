/**
 * ResultsFinalPage.jsx
 * Mevcut results_final.html — Final raporu, Excel dışa aktarma, yazdırma.
 * İki sekme: Bireysel (GENEL TASNİF) + Takım Sıralaması.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}
 *   competitions/{compId}/athletes
 *   competitions/{compId}/results
 *   competitions/{compId}/jury
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { getScoringRule } from '../lib/DataService';

export default function ResultsFinalPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast } = useNotification();

    const compId = getActiveCompId();

    const [comp, setComp] = useState(null);
    const [categories, setCategories] = useState({});
    const [athletes, setAthletes] = useState([]);
    const [scores, setScores] = useState({});
    const [selectedCatId, setSelectedCatId] = useState('');
    const [activeTab, setActiveTab] = useState('ind'); // 'ind' | 'team'

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        (async () => {
            const snap = await get(ref(db, `competitions/${compId}`));
            if (!snap.exists()) return;
            const data = snap.val();
            setComp(data);
            setCategories(data.categories || {});
            setAthletes(Object.values(data.athletes || {}));
            const [resSnap] = await Promise.all([
                get(ref(db, `competitions/${compId}/results`)),
            ]);
            setScores(resSnap.val() || {});

            const catIds = Object.keys(data.categories || {});
            if (catIds[0]) setSelectedCatId(catIds[0]);
        })();
    }, [compId]);

    const currentCat = categories[selectedCatId] || null;
    const rule = currentCat ? getScoringRule(currentCat) : 'sum';

    // ── Bireysel sıralama ─────────────────────────────────────────────────
    const individualRanking = useMemo(() => {
        if (!currentCat) return [];
        const filtered = athletes.filter(a =>
            (a.category === currentCat.id) || (a.categoryId === currentCat.id) || (a.catId === currentCat.id)
        );
        const rows = filtered.map(a => {
            const res = scores[a.uniqueId] || scores[a.id] || {};
            const r1 = res.r1?.total ?? null;
            const r2 = res.r2?.total ?? null;
            let total = 0;
            if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
            else total = (r1 || 0) + (r2 || 0);
            return {
                a, r1, r2, total,
                s1: res.r1?.status, s2: res.r2?.status,
            };
        });
        rows.sort((a, b) => b.total - a.total);
        return rows;
    }, [athletes, scores, currentCat, rule]);

    // ── Takım Sıralaması ──────────────────────────────────────────────────
    const teamRanking = useMemo(() => {
        if (!currentCat) return [];
        const byClub = {};
        individualRanking.forEach(row => {
            const club = row.a.club || 'Bilinmeyen';
            if (!byClub[club]) byClub[club] = [];
            byClub[club].push(row);
        });
        const teams = Object.entries(byClub).map(([club, rows]) => {
            rows.sort((a, b) => b.total - a.total);
            const top3 = rows.slice(0, 3);
            const teamTotal = top3.reduce((s, r) => s + r.total, 0);
            return { club, members: rows, top3, teamTotal };
        });
        teams.sort((a, b) => b.teamTotal - a.teamTotal);
        return teams;
    }, [individualRanking, currentCat]);

    function fmtScore(val, status) {
        if (status === 'dns') return 'DNS';
        if (status === 'dnf') return 'DNF';
        if (val == null) return '-';
        return Number(val).toFixed(3);
    }

    // ── Excel ────────────────────────────────────────────────────────────
    async function loadXLSX() {
        if (window.XLSX) return window.XLSX;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        return window.XLSX;
    }

    async function exportSingleToExcel() {
        if (!currentCat) return;
        const XLSX = await loadXLSX();
        const headers = ['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'R2', 'Toplam'];
        const rows = individualRanking.map((r, i) => [
            i + 1, `${r.a.name} ${r.a.surname}`, r.a.club || '',
            fmtScore(r.r1, r.s1), fmtScore(r.r2, r.s2), r.total.toFixed(3),
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentCat.name.substring(0, 30));
        XLSX.writeFile(wb, `${currentCat.name}_Sonuclar.xlsx`);
    }

    async function exportAllToExcel() {
        if (!comp) return;
        const XLSX = await loadXLSX();
        const wb = XLSX.utils.book_new();
        Object.values(categories).forEach(cat => {
            const r = getScoringRule(cat);
            const filtered = athletes.filter(a =>
                (a.category === cat.id) || (a.categoryId === cat.id) || (a.catId === cat.id)
            );
            const rows = filtered.map(a => {
                const res = scores[a.uniqueId] || scores[a.id] || {};
                const r1 = res.r1?.total ?? null;
                const r2 = res.r2?.total ?? null;
                const tot = r === 'max' ? Math.max(r1 || 0, r2 || 0) : ((r1 || 0) + (r2 || 0));
                return { name: `${a.name} ${a.surname}`, club: a.club || '', r1, r2, total: tot };
            });
            rows.sort((a, b) => b.total - a.total);
            const aoa = [['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'R2', 'Toplam']];
            rows.forEach((x, i) => aoa.push([
                i + 1, x.name, x.club,
                x.r1?.toFixed(3) || '-',
                x.r2?.toFixed(3) || '-',
                x.total.toFixed(3),
            ]));
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            XLSX.utils.book_append_sheet(wb, ws, cat.name.substring(0, 30));
        });
        XLSX.writeFile(wb, `${comp.name || 'Yarisma'}_Tum_Sonuclar.xlsx`);
    }

    function printAll() {
        window.print();
    }

    if (!compId) return null;

    return (
        <div style={{ minHeight: '100vh' }}>
            {/* Top Bar */}
            <nav className="topnav" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <div style={{ color: 'white', fontWeight: 700 }}>{comp?.name || '—'}</div>
                        <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>SONUÇ RAPORU</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={selectedCatId} onChange={e => setSelectedCatId(e.target.value)}
                        style={{ minWidth: 220 }}>
                        <option value="">Kategori seç...</option>
                        {Object.values(categories).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <button className="btn btn-outline btn-sm" onClick={exportSingleToExcel} disabled={!currentCat}>
                        <i className="material-icons-round">download</i> Excel
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={exportAllToExcel}>
                        <i className="material-icons-round">file_download</i> Tümü
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={printAll}>
                        <i className="material-icons-round">print</i> Yazdır
                    </button>
                </div>
            </nav>

            <div className="container">
                {/* Tabs */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button
                        className={'btn ' + (activeTab === 'ind' ? 'btn-primary' : 'btn-outline')}
                        onClick={() => setActiveTab('ind')}>
                        GENEL TASNİF
                    </button>
                    <button
                        className={'btn ' + (activeTab === 'team' ? 'btn-primary' : 'btn-outline')}
                        onClick={() => setActiveTab('team')}>
                        TAKIM SIRALAMASI
                    </button>
                </div>

                {/* Body */}
                <div className="card">
                    <div className="card-header flex-between">
                        <h3 className="card-title">
                            {currentCat?.name || 'Kategori Seçin'}
                            {currentCat && rule === 'max' && (
                                <span style={{
                                    marginLeft: 10, fontSize: '0.75rem', background: 'rgba(253,185,49,0.15)',
                                    color: '#fbbf24', padding: '2px 8px', borderRadius: 4,
                                }}>GEÇERLİ PUAN = MAX(R1,R2)</span>
                            )}
                        </h3>
                        <div className="text-muted">
                            {activeTab === 'ind' ? `${individualRanking.length} sporcu` : `${teamRanking.length} kulüp`}
                        </div>
                    </div>
                    <div className="card-body" style={{ padding: 0 }}>
                        {!currentCat && (
                            <div className="text-center text-muted" style={{ padding: 40 }}>
                                Lütfen kategori seçin
                            </div>
                        )}

                        {currentCat && activeTab === 'ind' && (
                            <div className="table-responsive">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 60 }}>Sıra</th>
                                            <th>Ad Soyad / Kulüp</th>
                                            <th style={{ width: 120, textAlign: 'right' }}>R1</th>
                                            <th style={{ width: 120, textAlign: 'right' }}>R2</th>
                                            <th style={{ width: 140, textAlign: 'right' }}>
                                                {rule === 'max' ? 'GEÇERLİ PUAN' : 'TOPLAM'}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {individualRanking.map((row, i) => (
                                            <tr key={row.a.id}>
                                                <td style={{
                                                    fontFamily: "'Space Mono',monospace",
                                                    fontWeight: 700, fontSize: '1.1rem',
                                                    color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '',
                                                }}>{i + 1}</td>
                                                <td>
                                                    <div style={{ fontWeight: 700 }}>
                                                        {row.a.name} {row.a.surname}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{row.a.club}</div>
                                                </td>
                                                <td style={{ textAlign: 'right', fontFamily: "'Space Mono',monospace" }}>{fmtScore(row.r1, row.s1)}</td>
                                                <td style={{ textAlign: 'right', fontFamily: "'Space Mono',monospace" }}>{fmtScore(row.r2, row.s2)}</td>
                                                <td style={{
                                                    textAlign: 'right', fontFamily: "'Space Mono',monospace",
                                                    fontSize: '1.1rem', fontWeight: 700, color: '#38bdf8',
                                                }}>
                                                    {row.total.toFixed(3)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {currentCat && activeTab === 'team' && (
                            <div className="table-responsive">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 60 }}>Sıra</th>
                                            <th>Kulüp</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Üye</th>
                                            <th>İlk 3 Sporcu</th>
                                            <th style={{ width: 140, textAlign: 'right' }}>Takım Toplamı</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {teamRanking.map((t, i) => (
                                            <tr key={t.club}>
                                                <td style={{
                                                    fontFamily: "'Space Mono',monospace",
                                                    fontWeight: 700, fontSize: '1.1rem',
                                                    color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '',
                                                }}>{i + 1}</td>
                                                <td><strong>{t.club}</strong></td>
                                                <td style={{ textAlign: 'center' }}>{t.members.length}</td>
                                                <td style={{ fontSize: '0.85rem' }}>
                                                    {t.top3.map((r, idx) => (
                                                        <div key={idx}>
                                                            {r.a.name} {r.a.surname} — <span style={{ color: '#38bdf8' }}>{r.total.toFixed(3)}</span>
                                                        </div>
                                                    ))}
                                                </td>
                                                <td style={{
                                                    textAlign: 'right', fontFamily: "'Space Mono',monospace",
                                                    fontSize: '1.1rem', fontWeight: 700, color: '#38bdf8',
                                                }}>
                                                    {t.teamTotal.toFixed(3)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
