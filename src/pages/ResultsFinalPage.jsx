/**
 * ResultsFinalPage.jsx
 * Final sonuç raporu — bireysel + sync çift, Excel dışa aktarma, yazdırma.
 *
 * Firebase yolları:
 *   competitions/{compId}/categories
 *   competitions/{compId}/athletes
 *   competitions/{compId}/pairs
 *   competitions/{compId}/results
 *
 * Sync sıralama mantığı (düzeltildi):
 *   1. Pair oluşturulmuş çiftler → scores[pair.id]
 *   2. Henüz pair oluşturulmamış bireysel sporcular → scores[athlete.id]
 *   Her ikisi de aynı tabloda gösterilir.
 *
 * Real-time: onValue ile canlı güncelleme.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { getScoringRule, getAthleteName, getAthleteClub } from '../lib/DataService';

export default function ResultsFinalPage() {
    const navigate  = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast } = useNotification();

    const compId = getActiveCompId();

    const [comp,        setComp]        = useState(null);
    const [categories,  setCategories]  = useState({});
    const [athletes,    setAthletes]    = useState([]);
    const [pairs,       setPairs]       = useState({});
    const [scores,      setScores]      = useState({});
    const [selectedCatId, setSelectedCatId] = useState('');
    const [activeTab,   setActiveTab]   = useState('ind'); // 'ind' | 'team'
    const [lastUpdate,  setLastUpdate]  = useState(null);

    // ── Real-time Firebase bağlantısı ─────────────────────────────────────
    useEffect(() => {
        if (!compId) { navigate('/'); return; }

        const unsubs = [];

        // Yarışma metadata (ad, vb.)
        const metaUnsub = onValue(ref(db, `competitions/${compId}/name`), snap => {
            if (snap.exists()) setComp(c => ({ ...c, name: snap.val() }));
        });
        unsubs.push(metaUnsub);

        // Kategoriler
        const catUnsub = onValue(ref(db, `competitions/${compId}/categories`), snap => {
            const val = snap.val() || {};
            setCategories(val);
            // İlk yüklemede otomatik seç
            setSelectedCatId(prev => prev || Object.keys(val)[0] || '');
        });
        unsubs.push(catUnsub);

        // Sporcular
        const athUnsub = onValue(ref(db, `competitions/${compId}/athletes`), snap => {
            setAthletes(Object.values(snap.val() || {}));
        });
        unsubs.push(athUnsub);

        // Çiftler
        const pairUnsub = onValue(ref(db, `competitions/${compId}/pairs`), snap => {
            setPairs(snap.val() || {});
        });
        unsubs.push(pairUnsub);

        // Sonuçlar — canlı dinle
        const resUnsub = onValue(ref(db, `competitions/${compId}/results`), snap => {
            setScores(snap.val() || {});
            setLastUpdate(new Date());
        });
        unsubs.push(resUnsub);

        return () => unsubs.forEach(u => u && u());
    }, [compId]);

    const currentCat = categories[selectedCatId] || null;
    const rule       = currentCat ? getScoringRule(currentCat) : 'sum';
    const isSync     = currentCat?.type === 'sync';

    // ── Bireysel / Çift sıralama ──────────────────────────────────────────
    const individualRanking = useMemo(() => {
        if (!currentCat) return [];

        const rows = [];
        const addedIds = new Set(); // Tekrar eklemeyi önle

        if (isSync) {
            // --- Sync kategorisi ---

            // 1. Pair tabanlı sonuçlar (çift oluşturulmuş)
            const catPairs = Object.values(pairs).filter(p => p.categoryId === currentCat.id);
            catPairs.forEach(pair => {
                const res = scores[pair.id] || {};
                const r1d = res.r1 || null;
                const r2d = res.r2 || null;
                const r1 = r1d?.total ?? null;
                const r2 = r2d?.total ?? null;
                let total = 0;
                if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
                else total = (r1 || 0) + (r2 || 0);

                const a1 = athletes.find(a => a.id === pair.athlete1Id) || {};
                rows.push({
                    a: {
                        id: pair.id,
                        name: pair.displayName,
                        surname: '',
                        club: pair.club || a1.club || '',
                        isPair: true,
                        pairName: pair.displayName,
                    },
                    r1, r2, total,
                    r1d, r2d,
                    s1: r1d?.status, s2: r2d?.status,
                    hasPair: true,
                });
                // Bu çiftin sporcularını "zaten işlendi" olarak işaretle
                addedIds.add(pair.athlete1Id);
                addedIds.add(pair.athlete2Id);
                addedIds.add(pair.id);
            });

            // 2. Pair oluşturulmamış bireysel sporcular (sync kategorisinde ama çiftsiz)
            athletes.forEach(a => {
                if (addedIds.has(a.id)) return;
                const inCat = a.category === currentCat.id || a.catId === currentCat.id || a.categoryId === currentCat.id;
                if (!inCat) return;

                const res = scores[a.id] || {};
                const r1d = res.r1 || null;
                const r2d = res.r2 || null;
                const r1 = r1d?.total ?? null;
                const r2 = r2d?.total ?? null;
                let total = 0;
                if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
                else total = (r1 || 0) + (r2 || 0);

                rows.push({
                    a,
                    r1, r2, total,
                    r1d, r2d,
                    s1: r1d?.status, s2: r2d?.status,
                    hasPair: false, // çiftsiz bireysel
                });
                addedIds.add(a.id);
            });

        } else {
            // --- Bireysel kategori ---
            const filtered = athletes.filter(a =>
                a.category === currentCat.id || a.catId === currentCat.id || a.categoryId === currentCat.id
            );
            filtered.forEach(a => {
                const res = scores[a.uniqueId] || scores[a.id] || {};
                const r1d = res.r1 || null;
                const r2d = res.r2 || null;
                const r1 = r1d?.total ?? null;
                const r2 = r2d?.total ?? null;
                let total = 0;
                if (rule === 'max') total = Math.max(r1 || 0, r2 || 0);
                else total = (r1 || 0) + (r2 || 0);
                rows.push({
                    a, r1, r2, total,
                    r1d, r2d,
                    s1: r1d?.status, s2: r2d?.status,
                });
            });
        }

        rows.sort((a, b) => b.total - a.total);
        return rows;
    }, [athletes, pairs, scores, currentCat, rule, isSync]);

    // ── Takım Sıralaması ──────────────────────────────────────────────────
    const teamRanking = useMemo(() => {
        if (!currentCat) return [];
        const byClub = {};
        individualRanking.forEach(row => {
            const club = getAthleteClub(row.a) || row.a.club || 'Bilinmeyen';
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

    // ── Formatlama yardımcıları ───────────────────────────────────────────
    function fmtScore(val, status) {
        if (status === 'dns') return 'DNS';
        if (status === 'dnf') return 'DNF';
        if (val == null) return '-';
        return Number(val).toFixed(3);
    }

    function fmtDetail(rd) {
        if (!rd || rd.status === 'dns' || rd.status === 'dnf') return null;
        const parts = [];
        if (rd.d != null) parts.push(`D:${Number(rd.d).toFixed(1)}`);
        if (rd.e != null) parts.push(`E:${Number(rd.e).toFixed(2)}`);
        if (rd.t != null && rd.t > 0) parts.push(`T:${Number(rd.t).toFixed(3)}`);
        if (rd.s != null && rd.s > 0) parts.push(`S:${Number(rd.sRaw ?? rd.s).toFixed(2)}`);
        if (rd.h != null && rd.h > 0) parts.push(`H:${Number(rd.h).toFixed(2)}`);
        if (rd.p != null && rd.p > 0) parts.push(`P:-${Number(rd.p).toFixed(1)}`);
        return parts.join('  ');
    }

    // ── Excel ────────────────────────────────────────────────────────────
    function exportSingleToExcel() {
        if (!currentCat) return;
        const headers = ['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'R2', 'Toplam'];
        const rows = individualRanking.map((r, i) => [
            i + 1,
            r.a.pairName || getAthleteName(r.a),
            getAthleteClub(r.a) || r.a.club || '',
            fmtScore(r.r1, r.s1),
            fmtScore(r.r2, r.s2),
            r.total.toFixed(3),
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentCat.name.substring(0, 30));
        XLSX.writeFile(wb, `${currentCat.name}_Sonuclar.xlsx`);
    }

    function exportAllToExcel() {
        const wb = XLSX.utils.book_new();

        Object.values(categories).forEach(cat => {
            const r = getScoringRule(cat);
            const catIsSync = cat.type === 'sync';
            const aoa = [['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'R2', 'Toplam']];
            const rows = [];
            const addedIds2 = new Set();

            if (catIsSync) {
                // Pair sonuçları
                Object.values(pairs)
                    .filter(p => p.categoryId === cat.id)
                    .forEach(pair => {
                        const res = scores[pair.id] || {};
                        const r1 = res.r1?.total ?? null;
                        const r2 = res.r2?.total ?? null;
                        const tot = r === 'max' ? Math.max(r1 || 0, r2 || 0) : ((r1 || 0) + (r2 || 0));
                        rows.push({ name: pair.displayName, club: pair.club || '', r1, r2, total: tot });
                        addedIds2.add(pair.athlete1Id);
                        addedIds2.add(pair.athlete2Id);
                        addedIds2.add(pair.id);
                    });
                // Çiftsiz bireysel
                athletes
                    .filter(a => (a.category === cat.id || a.catId === cat.id) && !addedIds2.has(a.id))
                    .forEach(a => {
                        const res = scores[a.id] || {};
                        const r1 = res.r1?.total ?? null;
                        const r2 = res.r2?.total ?? null;
                        const tot = r === 'max' ? Math.max(r1 || 0, r2 || 0) : ((r1 || 0) + (r2 || 0));
                        rows.push({ name: getAthleteName(a), club: getAthleteClub(a), r1, r2, total: tot });
                    });
            } else {
                athletes
                    .filter(a => a.category === cat.id || a.catId === cat.id || a.categoryId === cat.id)
                    .forEach(a => {
                        const res = scores[a.uniqueId] || scores[a.id] || {};
                        const r1 = res.r1?.total ?? null;
                        const r2 = res.r2?.total ?? null;
                        const tot = r === 'max' ? Math.max(r1 || 0, r2 || 0) : ((r1 || 0) + (r2 || 0));
                        rows.push({ name: getAthleteName(a), club: getAthleteClub(a), r1, r2, total: tot });
                    });
            }

            rows.sort((x, y) => y.total - x.total);
            rows.forEach((x, i) => aoa.push([
                i + 1,
                x.name,
                x.club,
                x.r1?.toFixed(3) || '-',
                x.r2?.toFixed(3) || '-',
                x.total.toFixed(3),
            ]));
            if (aoa.length > 1) {
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                XLSX.utils.book_append_sheet(wb, ws, cat.name.substring(0, 30));
            }
        });

        XLSX.writeFile(wb, `${comp?.name || 'Yarisma'}_Tum_Sonuclar.xlsx`);
    }

    function printAll() { window.print(); }

    if (!compId) return null;

    return (
        <div style={{ minHeight: '100vh' }}>
            {/* ── Top Bar ─────────────────────────────────────────────── */}
            <nav className="topnav" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <div style={{ color: 'white', fontWeight: 700 }}>{comp?.name || '—'}</div>
                        <div style={{ color: '#94a3b8', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="material-icons-round" style={{ fontSize: 12, color: '#10b981' }}>fiber_manual_record</i>
                            CANLI — SONUÇ RAPORU
                            {lastUpdate && (
                                <span style={{ color: '#475569' }}>
                                    · {lastUpdate.toLocaleTimeString('tr-TR')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                {/* Sekmeler */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button className={'btn ' + (activeTab === 'ind' ? 'btn-primary' : 'btn-outline')}
                        onClick={() => setActiveTab('ind')}>
                        GENEL TASNİF
                    </button>
                    <button className={'btn ' + (activeTab === 'team' ? 'btn-primary' : 'btn-outline')}
                        onClick={() => setActiveTab('team')}>
                        TAKIM SIRALAMASI
                    </button>
                </div>

                {/* İçerik */}
                <div className="card">
                    <div className="card-header flex-between">
                        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isSync && (
                                <i className="material-icons-round" style={{ color: '#c084fc', fontSize: 20 }}>sync</i>
                            )}
                            {currentCat?.name || 'Kategori Seçin'}
                            {currentCat && rule === 'max' && (
                                <span style={{
                                    fontSize: '0.75rem', background: 'rgba(253,185,49,0.15)',
                                    color: '#fbbf24', padding: '2px 8px', borderRadius: 4,
                                }}>
                                    GEÇERLİ = MAX(R1,R2)
                                </span>
                            )}
                            {isSync && (
                                <span style={{
                                    fontSize: '0.75rem', background: 'rgba(192,132,252,0.15)',
                                    color: '#c084fc', padding: '2px 8px', borderRadius: 4,
                                }}>
                                    SENKRONİZE
                                </span>
                            )}
                        </h3>
                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                            {activeTab === 'ind'
                                ? `${individualRanking.length} kayıt`
                                : `${teamRanking.length} kulüp`}
                        </div>
                    </div>

                    <div className="card-body" style={{ padding: 0 }}>
                        {!currentCat && (
                            <div className="text-center text-muted" style={{ padding: 40 }}>
                                Lütfen kategori seçin
                            </div>
                        )}

                        {/* ── GENEL TASNİF ──────────────────────────────── */}
                        {currentCat && activeTab === 'ind' && (
                            <div className="table-responsive">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 56 }}>Sıra</th>
                                            <th>Ad Soyad / Kulüp</th>
                                            <th style={{ width: 130, textAlign: 'right' }}>R1</th>
                                            <th style={{ width: 130, textAlign: 'right' }}>R2</th>
                                            <th style={{ width: 150, textAlign: 'right' }}>
                                                {rule === 'max' ? 'GEÇERLİ PUAN' : 'TOPLAM'}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {individualRanking.length === 0 && (
                                            <tr>
                                                <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                                                    {isSync
                                                        ? 'Henüz sonuç yok. Çift oluşturun ve puanlayın.'
                                                        : 'Henüz yayınlanmış sonuç yok.'}
                                                </td>
                                            </tr>
                                        )}
                                        {individualRanking.map((row, i) => {
                                            const medal = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '';
                                            const detail1 = fmtDetail(row.r1d);
                                            const detail2 = fmtDetail(row.r2d);
                                            return (
                                                <tr key={row.a.id}
                                                    style={i < 3 ? { background: `${medal}08` } : {}}>
                                                    <td style={{
                                                        fontFamily: "'Space Mono',monospace",
                                                        fontWeight: 700, fontSize: '1.15rem', color: medal || 'inherit',
                                                    }}>
                                                        {i < 3
                                                            ? <i className="material-icons-round" style={{ fontSize: 22, color: medal }}>
                                                                {i === 0 ? 'looks_one' : i === 1 ? 'looks_two' : 'looks_3'}
                                                              </i>
                                                            : i + 1}
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            {row.a.isPair && (
                                                                <i className="material-icons-round" style={{ fontSize: 14, color: '#c084fc' }}>sync</i>
                                                            )}
                                                            {row.a.pairName || getAthleteName(row.a)}
                                                            {row.hasPair === false && isSync && (
                                                                <span style={{
                                                                    fontSize: '0.65rem', background: 'rgba(251,191,36,0.15)',
                                                                    color: '#fbbf24', padding: '1px 6px', borderRadius: 4,
                                                                    border: '1px solid rgba(251,191,36,0.3)',
                                                                }}>
                                                                    çiftsiz
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                                            {getAthleteClub(row.a) || row.a.club || '—'}
                                                        </div>
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{
                                                            fontFamily: "'Space Mono',monospace",
                                                            fontWeight: 700, fontSize: '1rem',
                                                            color: row.s1 ? '#94a3b8' : 'inherit',
                                                        }}>
                                                            {fmtScore(row.r1, row.s1)}
                                                        </div>
                                                        {detail1 && (
                                                            <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>
                                                                {detail1}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{
                                                            fontFamily: "'Space Mono',monospace",
                                                            fontWeight: 700, fontSize: '1rem',
                                                            color: row.s2 ? '#94a3b8' : 'inherit',
                                                        }}>
                                                            {fmtScore(row.r2, row.s2)}
                                                        </div>
                                                        {detail2 && (
                                                            <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>
                                                                {detail2}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{
                                                            fontFamily: "'Space Mono',monospace",
                                                            fontSize: '1.2rem', fontWeight: 700,
                                                            color: medal || '#38bdf8',
                                                        }}>
                                                            {row.total > 0 ? row.total.toFixed(3) : (row.r1 != null || row.r2 != null ? row.total.toFixed(3) : '-')}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* ── TAKIM SIRALAMASI ──────────────────────────── */}
                        {currentCat && activeTab === 'team' && (
                            <div className="table-responsive">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 56 }}>Sıra</th>
                                            <th>Kulüp</th>
                                            <th style={{ width: 70, textAlign: 'center' }}>Üye</th>
                                            <th>İlk 3 Sporcu/Çift</th>
                                            <th style={{ width: 150, textAlign: 'right' }}>Takım Toplamı</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {teamRanking.length === 0 && (
                                            <tr>
                                                <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                                                    Henüz veri yok.
                                                </td>
                                            </tr>
                                        )}
                                        {teamRanking.map((t, i) => {
                                            const medal = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '';
                                            return (
                                                <tr key={t.club} style={i < 3 ? { background: `${medal}08` } : {}}>
                                                    <td style={{
                                                        fontFamily: "'Space Mono',monospace",
                                                        fontWeight: 700, fontSize: '1.15rem', color: medal || 'inherit',
                                                    }}>
                                                        {i < 3
                                                            ? <i className="material-icons-round" style={{ fontSize: 22, color: medal }}>
                                                                {i === 0 ? 'looks_one' : i === 1 ? 'looks_two' : 'looks_3'}
                                                              </i>
                                                            : i + 1}
                                                    </td>
                                                    <td><strong>{t.club}</strong></td>
                                                    <td style={{ textAlign: 'center' }}>{t.members.length}</td>
                                                    <td style={{ fontSize: '0.85rem' }}>
                                                        {t.top3.map((r, idx) => (
                                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                {r.a.isPair && <i className="material-icons-round" style={{ fontSize: 11, color: '#c084fc' }}>sync</i>}
                                                                <span>{r.a.pairName || getAthleteName(r.a)}</span>
                                                                <span style={{ color: '#38bdf8', marginLeft: 4 }}>
                                                                    {r.total.toFixed(3)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </td>
                                                    <td style={{
                                                        textAlign: 'right',
                                                        fontFamily: "'Space Mono',monospace",
                                                        fontSize: '1.15rem', fontWeight: 700,
                                                        color: medal || '#38bdf8',
                                                    }}>
                                                        {t.teamTotal.toFixed(3)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
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
