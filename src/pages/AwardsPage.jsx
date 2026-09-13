/**
 * AwardsPage.jsx
 * Dereceler — yarışma seçilir, derece yapan sporcular ve kulüpleri listelenir.
 *
 * Salt okunur: hiçbir şey yazmaz.
 *
 * Derecenin hangi puanlardan alındığı:
 *   • Bireysel → kategorinin FİNALİ varsa finalden, yoksa elemeden.
 *   • Takım    → her zaman ELEME kategorisinden (finalde takım yapılmaz).
 *
 * Firebase yolları (hepsi okuma):
 *   competitions                                  → yarışma listesi
 *   competitions/{compId}/categories | athletes | pairs | results
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import {
    getAthleteName, getAthleteClub, getPairDisplayName,
    computeRoutineTotals, computeTeamRanking, isDNX,
} from '../lib/DataService';
import { useRules, resolveCategoryRules, resolveTeamSourceCategory } from '../lib/Rules';

const MEDALS = [
    { color: '#FFD700', label: 'ALTIN',  short: '1.' },
    { color: '#C0C0C0', label: 'GÜMÜŞ',  short: '2.' },
    { color: '#CD7F32', label: 'BRONZ',  short: '3.' },
];
const medalOf = (rank) => MEDALS[rank - 1] || null;

export default function AwardsPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast } = useNotification();

    const [comps,      setComps]      = useState([]);
    const [compId,     setCompId]     = useState(() => getActiveCompId() || '');
    const [categories, setCategories] = useState({});
    const [athletes,   setAthletes]   = useState([]);
    const [pairs,      setPairs]      = useState({});
    const [scores,     setScores]     = useState({});
    const [loading,    setLoading]    = useState(false);

    const rules = useRules(compId);
    const comp  = comps.find(c => c.id === compId) || null;

    // ── Yarışma listesi ───────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const snap = await get(ref(db, 'competitions'));
                const list = Object.values(snap.val() || {}).filter(c => c && c.id);
                list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                setComps(list);
                setCompId(prev => prev || list[0]?.id || '');
            } catch (e) {
                toast('Yarışmalar yüklenemedi: ' + e.message, 'error');
            }
        })();
    }, []);

    // ── Seçili yarışmanın verisi ──────────────────────────────────────────
    useEffect(() => {
        if (!compId) {
            setCategories({}); setAthletes([]); setPairs({}); setScores({});
            return;
        }
        setLoading(true);
        const unsubs = [];
        unsubs.push(onValue(ref(db, `competitions/${compId}/categories`), s => {
            setCategories(s.val() || {}); setLoading(false);
        }));
        unsubs.push(onValue(ref(db, `competitions/${compId}/athletes`), s => setAthletes(Object.values(s.val() || {}))));
        unsubs.push(onValue(ref(db, `competitions/${compId}/pairs`), s => setPairs(s.val() || {})));
        unsubs.push(onValue(ref(db, `competitions/${compId}/results`), s => setScores(s.val() || {})));
        return () => unsubs.forEach(u => u && u());
    }, [compId]);

    const athletesById = useMemo(() => {
        const m = {};
        athletes.forEach(a => { if (a?.id) m[a.id] = a; });
        return m;
    }, [athletes]);

    function athleteInCategory(a, cat) {
        if (!a || !cat) return false;
        return [a.category, a.categoryId, a.catId]
            .filter(v => v != null && v !== '')
            .some(v => v === cat.id || v === cat.name);
    }

    /** Bir kategorinin sıralaması — ResultsFinalPage ile aynı mantık. */
    function buildRanking(cat) {
        if (!cat) return [];
        const cr = resolveCategoryRules(rules, cat);
        const rows = [];
        const pById = {};
        Object.values(pairs).forEach(p => { if (p?.id) pById[p.id] = p; });
        const catAths = athletes.filter(a => athleteInCategory(a, cat));

        const push = (name, club, res, aRef) => {
            const r1d = res.r1 || null, r2d = res.r2 || null;
            const { r1, r2, total } = computeRoutineTotals(r1d, r2d, cr.scoringRule);
            rows.push({ name, club, r1, r2, total, a: aRef, s1: r1d?.status, s2: r2d?.status });
        };

        if (cat.type === 'sync') {
            const seen = new Set();
            catAths.forEach(a => {
                if (a.pairId && pById[a.pairId]) {
                    if (seen.has(a.pairId)) return;
                    seen.add(a.pairId);
                    const pair = pById[a.pairId];
                    const res = scores[pair.id] || scores[pair.athlete1Id] || scores[pair.athlete2Id] || {};
                    push(getPairDisplayName(pair, athletesById) || '—', pair.club || a.club || '', res, a);
                } else {
                    push(getAthleteName(a), getAthleteClub(a), scores[a.uniqueId] || scores[a.id] || {}, a);
                }
            });
        } else {
            catAths.forEach(a => {
                push(getAthleteName(a), getAthleteClub(a), scores[a.uniqueId] || scores[a.id] || {}, a);
            });
        }

        const scored = rows.filter(x => x.r1 != null || x.r2 != null).sort((a, b) => b.total - a.total);
        let lastTotal = null, lastRank = 0;
        scored.forEach((x, i) => {
            if (lastTotal !== null && x.total === lastTotal) x.rank = lastRank;
            else { x.rank = i + 1; lastRank = x.rank; lastTotal = x.total; }
        });
        return scored;
    }

    // ── Dereceler ─────────────────────────────────────────────────────────
    const awards = useMemo(() => {
        const all = Object.values(categories);
        // Final kategorileri ayrı satır olarak listelenmez; ait olduğu elemenin
        // bireysel derecesini belirler.
        const base = all.filter(c => !(c.isFinal || c.id.endsWith('_final')));
        const finalOf = (cat) =>
            all.find(c => (c.isFinal || c.id.endsWith('_final')) &&
                (c.parentCategoryId === cat.id || c.id === `${cat.id}_final`)) || null;

        return base.map(cat => {
            const fin     = finalOf(cat);
            const indCat  = fin || cat;
            const podium  = buildRanking(indCat).filter(r => r.rank && r.rank <= 3);

            // Takım — her zaman eleme kategorisinden
            const teamSrc = resolveTeamSourceCategory(rules, cat);
            let teams = [];
            if (teamSrc) {
                const tcr = resolveCategoryRules(rules, teamSrc);
                teams = computeTeamRanking(buildRanking(teamSrc), {
                    topN: tcr.teamTopN,
                    minAthletes: tcr.teamMinAthletes,
                    mode: tcr.teamMode,
                    perRoutineMinAthletes: tcr.teamPerRoutineMinAthletes,
                    routineCount: tcr.routineCount,
                    scoringRule: tcr.teamScoringRule,
                }).slice(0, 3);
            }

            return { cat, fromFinal: !!fin, podium, teams };
        }).filter(x => x.podium.length > 0 || x.teams.length > 0);
    }, [categories, athletes, pairs, scores, rules]);

    // ── Kulüp madalya tablosu ─────────────────────────────────────────────
    const clubTable = useMemo(() => {
        const map = {};
        const add = (club, rank, kind) => {
            const key = club || 'Bilinmeyen';
            if (!map[key]) map[key] = { club: key, g: 0, s: 0, b: 0, bireysel: 0, takim: 0 };
            if (rank === 1) map[key].g++;
            else if (rank === 2) map[key].s++;
            else if (rank === 3) map[key].b++;
            map[key][kind]++;
        };
        awards.forEach(({ podium, teams }) => {
            podium.forEach(r => add(r.club, r.rank, 'bireysel'));
            teams.forEach((t, i) => add(t.club, i + 1, 'takim'));
        });
        return Object.values(map).sort((a, b) =>
            b.g - a.g || b.s - a.s || b.b - a.b || a.club.localeCompare(b.club, 'tr'));
    }, [awards]);

    const toplam = useMemo(() => ({
        sporcu: awards.reduce((n, a) => n + a.podium.length, 0),
        takim:  awards.reduce((n, a) => n + a.teams.length, 0),
        kulup:  clubTable.length,
    }), [awards, clubTable]);

    // ── TCF logolu PDF ────────────────────────────────────────────────────
    function printAwards() {
        if (awards.length === 0) { toast('Yazdırılacak derece yok.', 'warning'); return; }
        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
        const medalCell = (rank) => {
            const m = medalOf(rank);
            return `<span class="medal" style="background:${m ? m.color : '#e2e8f0'}">${rank}</span>`;
        };

        const satirlar = awards.map(({ cat, fromFinal, podium, teams }) => `
            <div class="block">
                <div class="cat-row">
                    <h2>${esc(cat.name)}</h2>
                    <span class="src">${fromFinal ? 'FİNAL SONUCU' : 'ELEME SONUCU'}</span>
                </div>
                ${podium.length ? `
                <table>
                    <thead><tr>
                        <th class="c" style="width:52px">DERECE</th>
                        <th>AD SOYAD</th><th>KULÜP</th>
                        <th class="c" style="width:86px">PUAN</th>
                    </tr></thead>
                    <tbody>
                        ${podium.map(r => `
                            <tr>
                                <td class="c">${medalCell(r.rank)}</td>
                                <td class="name-col">${esc(r.name)}</td>
                                <td class="club-col">${esc(r.club || '—')}</td>
                                <td class="score-col">${r.total.toFixed(3)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>` : ''}
                ${teams.length ? `
                <div class="sub-title">TAKIM</div>
                <table>
                    <thead><tr>
                        <th class="c" style="width:52px">DERECE</th>
                        <th>KULÜP</th>
                        <th class="c" style="width:86px">PUAN</th>
                    </tr></thead>
                    <tbody>
                        ${teams.map((t, i) => `
                            <tr>
                                <td class="c">${medalCell(i + 1)}</td>
                                <td class="name-col">${esc(t.club)}</td>
                                <td class="score-col">${t.teamTotal.toFixed(3)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>` : ''}
            </div>`).join('');

        const kulupTablo = `
            <div class="block">
                <div class="cat-row"><h2>KULÜP MADALYA TABLOSU</h2></div>
                <table>
                    <thead><tr>
                        <th class="c" style="width:46px">SIRA</th>
                        <th>KULÜP</th>
                        <th class="c" style="width:56px">ALTIN</th>
                        <th class="c" style="width:60px">GÜMÜŞ</th>
                        <th class="c" style="width:56px">BRONZ</th>
                        <th class="c" style="width:60px">TOPLAM</th>
                    </tr></thead>
                    <tbody>
                        ${clubTable.map((c, i) => `
                            <tr>
                                <td class="c rank-col">${i + 1}</td>
                                <td class="name-col">${esc(c.club)}</td>
                                <td class="c">${c.g}</td>
                                <td class="c">${c.s}</td>
                                <td class="c">${c.b}</td>
                                <td class="c total-col">${c.g + c.s + c.b}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>${esc(comp?.name || 'Yarışma')} — Dereceler</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  body { font-family:'Outfit',sans-serif; margin:0; color:#1e293b;
         -webkit-print-color-adjust:exact; print-color-adjust:exact; background:#e2e8f0; }
  .page { width:210mm; min-height:297mm; padding:12mm; margin:0 auto 10px; background:#fff;
          box-sizing:border-box; display:flex; flex-direction:column; }
  .header { background:#E30613; color:#fff; padding:14px 18px; border-radius:12px;
            margin-bottom:16px; display:flex; align-items:center; gap:16px; }
  .logo { width:64px; height:64px; background:#fff; border-radius:50%; padding:4px; flex-shrink:0; object-fit:contain; }
  .comp-name { font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:1px; opacity:.95; }
  .cat-name  { font-size:26px; font-weight:900; margin:2px 0 0; }
  .sub-header{ font-size:12px; font-weight:700; letter-spacing:3px; opacity:.9; margin-top:2px; }

  .block { margin-bottom:16px; page-break-inside:avoid; }
  .cat-row { display:flex; align-items:baseline; gap:10px; border-bottom:2px solid #303868;
             padding-bottom:4px; margin-bottom:6px; }
  .cat-row h2 { font-size:14px; font-weight:900; margin:0; color:#303868; text-transform:uppercase; }
  .src { font-size:9px; font-weight:700; letter-spacing:1px; color:#E30613; }
  .sub-title { font-size:10px; font-weight:800; letter-spacing:2px; color:#64748b; margin:8px 0 3px; }

  table { width:100%; border-collapse:collapse; font-size:11.5px; }
  thead th { background:#303868; color:#fff; padding:5px 9px; text-align:left;
             font-size:9px; letter-spacing:1px; font-weight:800; }
  thead th.c { text-align:center; }
  tbody td { padding:5px 9px; border-bottom:1px solid #e2e8f0; }
  tbody td.c { text-align:center; }
  tbody tr:nth-child(even) { background:#f8fafc; }
  .medal { display:inline-block; width:20px; height:20px; line-height:20px; border-radius:50%;
           font-weight:800; font-size:11px; color:#0f172a; }
  .name-col { font-weight:700; }
  .club-col { color:#64748b; font-size:10.5px; }
  .score-col, .total-col { text-align:center; font-family:'Space Mono',monospace; font-weight:700; }
  .rank-col { font-family:'Space Mono',monospace; font-weight:800; color:#303868; }

  .footer { margin-top:auto; padding-top:12px; border-top:1px solid #e2e8f0;
            display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; font-weight:500; }
  .signs { display:flex; justify-content:space-between; gap:24px; margin-top:22px; }
  .sign { flex:1; text-align:center; font-size:10px; color:#475569; font-weight:600; }
  .sign span { display:block; border-top:1px solid #94a3b8; margin-bottom:5px; height:32px; }
  @media print { body { background:#fff; } .page { margin:0; } }
</style></head>
<body>
  <div class="page">
    <div class="header">
      <img class="logo" src="${window.location.origin}/tcf-logo.png" alt="TCF" />
      <div>
        <div class="comp-name">${esc(comp?.name || '')}</div>
        <h1 class="cat-name">DERECE ALAN SPORCULAR</h1>
        <div class="sub-header">RESMÎ DERECE LİSTESİ</div>
      </div>
    </div>
    ${satirlar}
    ${kulupTablo}
    <div class="footer">
      <div>TCF TRAMBOLİN CİMNASTİK SİSTEMİ</div>
      <div>Oluşturulma: ${new Date().toLocaleString('tr-TR')}</div>
    </div>
    <div class="signs">
      <div class="sign"><span></span>Başhakem</div>
      <div class="sign"><span></span>Üst Jüri</div>
      <div class="sign"><span></span>Teknik Sorumlu</div>
    </div>
  </div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
</body></html>`;

        const w = window.open('', '_blank');
        if (!w) { toast('Açılır pencere engellendi — tarayıcı iznini kontrol edin.', 'error'); return; }
        w.document.write(html);
        w.document.close();
    }

    // ── Arayüz ────────────────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ color: 'white', fontWeight: 700 }}>DERECELER</div>
                        <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                            Derece alan sporcular ve kulüpleri
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <select
                        value={compId}
                        onChange={e => setCompId(e.target.value)}
                        style={{
                            padding: '8px 12px', borderRadius: 8, minWidth: 220, maxWidth: 340,
                            background: 'rgba(0,0,0,0.25)', color: 'white', fontWeight: 600,
                            border: '1px solid rgba(255,255,255,0.18)', fontFamily: "'Outfit', sans-serif",
                        }}
                    >
                        {comps.length === 0 && <option value="">Yarışma yok</option>}
                        {comps.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
                    </select>
                    <button className="btn btn-sm"
                        style={{ background: 'linear-gradient(135deg, #E02828, #A01C1C)', color: 'white' }}
                        onClick={printAwards} disabled={awards.length === 0}>
                        <i className="material-icons-round">picture_as_pdf</i> PDF
                    </button>
                </div>
            </nav>

            <div className="container">
                {/* Özet */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                    {[
                        ['emoji_events', 'Derece alan sporcu', toplam.sporcu, '#FFD700'],
                        ['groups', 'Derece alan takım', toplam.takim, '#7C87D8'],
                        ['apartment', 'Madalya alan kulüp', toplam.kulup, '#10b981'],
                    ].map(([icon, label, val, color]) => (
                        <div key={label} style={{
                            flex: '1 1 180px', background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12,
                            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                        }}>
                            <i className="material-icons-round" style={{ color, fontSize: 28 }}>{icon}</i>
                            <div>
                                <div style={{
                                    fontFamily: "'Space Mono',monospace", fontSize: '1.5rem',
                                    fontWeight: 700, color: '#f1f5f9', lineHeight: 1.1,
                                }}>{val}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{label}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {loading && (
                    <div className="card"><div className="card-body text-center text-muted" style={{ padding: 40 }}>
                        Yükleniyor...
                    </div></div>
                )}

                {!loading && awards.length === 0 && (
                    <div className="card"><div className="card-body text-center text-muted" style={{ padding: 40 }}>
                        Bu yarışmada henüz derece oluşmamış.
                    </div></div>
                )}

                {/* Kategoriler */}
                {awards.map(({ cat, fromFinal, podium, teams }) => (
                    <div className="card" key={cat.id} style={{ marginBottom: 14 }}>
                        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <h3 className="card-title" style={{ margin: 0 }}>{cat.name}</h3>
                            <span style={{
                                fontSize: '0.7rem', fontWeight: 700, letterSpacing: 1, padding: '2px 8px',
                                borderRadius: 4,
                                background: fromFinal ? 'rgba(224,40,40,0.15)' : 'rgba(148,163,184,0.15)',
                                color: fromFinal ? '#E02828' : '#94a3b8',
                            }}>
                                {fromFinal ? 'FİNAL SONUCU' : 'ELEME SONUCU'}
                            </span>
                        </div>
                        <div className="card-body" style={{ padding: '10px 16px 16px' }}>
                            {podium.map(r => {
                                const m = medalOf(r.rank);
                                return (
                                    <div key={`${r.a?.id || r.name}-${r.rank}`} style={{
                                        display: 'flex', alignItems: 'center', gap: 14,
                                        padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                                        background: `${m.color}0D`, border: `1px solid ${m.color}33`,
                                    }}>
                                        <div style={{
                                            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: m.color, color: '#0f172a',
                                            fontFamily: "'Space Mono',monospace", fontWeight: 700,
                                        }}>{r.rank}</div>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{
                                                fontWeight: 800, color: '#f1f5f9', fontSize: '1rem',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>{r.name}</div>
                                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 1 }}>
                                                {r.club || '—'}
                                            </div>
                                        </div>
                                        <div style={{
                                            fontFamily: "'Space Mono',monospace", fontWeight: 700,
                                            fontSize: '1.15rem', color: m.color, flexShrink: 0,
                                        }}>{r.total.toFixed(3)}</div>
                                    </div>
                                );
                            })}

                            {teams.length > 0 && (
                                <>
                                    <div style={{
                                        fontSize: '0.7rem', letterSpacing: 2, fontWeight: 800,
                                        color: '#64748b', margin: '14px 0 6px',
                                    }}>TAKIM</div>
                                    {teams.map((t, i) => {
                                        const m = medalOf(i + 1);
                                        return (
                                            <div key={t.club} style={{
                                                display: 'flex', alignItems: 'center', gap: 14,
                                                padding: '9px 12px', borderRadius: 10, marginBottom: 6,
                                                background: 'rgba(255,255,255,0.02)',
                                                border: `1px solid ${m.color}33`,
                                            }}>
                                                <div style={{
                                                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    background: m.color, color: '#0f172a',
                                                    fontFamily: "'Space Mono',monospace", fontWeight: 700,
                                                    fontSize: '0.85rem',
                                                }}>{i + 1}</div>
                                                <div style={{
                                                    flex: 1, minWidth: 0, fontWeight: 700, color: '#e2e8f0',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>{t.club}</div>
                                                <div style={{
                                                    fontFamily: "'Space Mono',monospace", fontWeight: 700,
                                                    color: '#A3ACD0', flexShrink: 0,
                                                }}>{t.teamTotal.toFixed(3)}</div>
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    </div>
                ))}

                {/* Kulüp madalya tablosu */}
                {clubTable.length > 0 && (
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-header">
                            <h3 className="card-title">Kulüp Madalya Tablosu</h3>
                        </div>
                        <div className="card-body" style={{ padding: 0 }}>
                            <div className="table-responsive">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 56 }}>Sıra</th>
                                            <th>Kulüp</th>
                                            <th style={{ width: 80, textAlign: 'center' }}>Altın</th>
                                            <th style={{ width: 80, textAlign: 'center' }}>Gümüş</th>
                                            <th style={{ width: 80, textAlign: 'center' }}>Bronz</th>
                                            <th style={{ width: 90, textAlign: 'center' }}>Toplam</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {clubTable.map((c, i) => (
                                            <tr key={c.club}>
                                                <td style={{
                                                    fontFamily: "'Space Mono',monospace", fontWeight: 700,
                                                    color: i < 3 ? MEDALS[i].color : '#64748b',
                                                }}>{i + 1}</td>
                                                <td style={{ fontWeight: 700 }}>
                                                    {c.club}
                                                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                                                        {c.bireysel} bireysel{c.takim ? ` · ${c.takim} takım` : ''}
                                                    </div>
                                                </td>
                                                {[['g', '#FFD700'], ['s', '#C0C0C0'], ['b', '#CD7F32']].map(([k, color]) => (
                                                    <td key={k} style={{
                                                        textAlign: 'center', fontFamily: "'Space Mono',monospace",
                                                        fontWeight: 700, color: c[k] ? color : '#475569',
                                                    }}>{c[k]}</td>
                                                ))}
                                                <td style={{
                                                    textAlign: 'center', fontFamily: "'Space Mono',monospace",
                                                    fontWeight: 700, color: '#f1f5f9',
                                                }}>{c.g + c.s + c.b}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
