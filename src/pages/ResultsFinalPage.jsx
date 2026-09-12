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
import {
    getScoringRule, getAthleteName, getAthleteClub,
    isDNX, formatResultScore, computeRoutineTotals, getPairDisplayName, computeTeamRanking,
} from '../lib/DataService';
import { useRules, resolveCategoryRules, resolveTeamSourceCategory } from '../lib/Rules';

export default function ResultsFinalPage() {
    const navigate  = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast } = useNotification();

    const compId = getActiveCompId();
    const rules = useRules(compId);

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
        // Kategori bazlı kurallar (seri sayısı, toplama, takım)
    const catRules   = resolveCategoryRules(rules, currentCat);
    const rule       = currentCat ? catRules.scoringRule : rules.flow.defaultScoringRule;
    const showR2     = catRules.routineCount >= 2;
    const isSync     = currentCat?.type === 'sync';


    // Çift adını ad+soyad olarak kurmak için kimliğe göre sporcu haritası
    const athletesById = useMemo(() => {
        const m = {};
        athletes.forEach(a => { if (a?.id) m[a.id] = a; });
        return m;
    }, [athletes]);

    // Sporcu kategori eşleşmesi (id veya isim)
    function athleteInCategory(a, cat) {
        if (!a || !cat) return false;
        const candidates = [a.category, a.categoryId, a.catId].filter(v => v != null && v !== '');
        return candidates.some(v => v === cat.id || v === cat.name);
    }

    // ── Bireysel / Çift sıralama ──────────────────────────────────────────
    const individualRanking = useMemo(() => {
        if (!currentCat) return [];

        const rows = [];

        if (isSync) {
            // --- Sync kategorisi: athlete.pairId üzerinden grupla ---
            const pairsById = {};
            Object.values(pairs).forEach(p => { if (p?.id) pairsById[p.id] = p; });

            const catAthletes = athletes.filter(a => athleteInCategory(a, currentCat));
            const seenPairs = new Set();

            catAthletes.forEach(a => {
                if (a.pairId && pairsById[a.pairId]) {
                    // Pair üyesi — sadece bir kere
                    if (seenPairs.has(a.pairId)) return;
                    seenPairs.add(a.pairId);
                    const pair = pairsById[a.pairId];
                    const res = scores[pair.id]
                        || scores[pair.athlete1Id]
                        || scores[pair.athlete2Id]
                        || {};
                    const r1d = res.r1 || null;
                    const r2d = res.r2 || null;
                    // DNS/DNF → sıralama dışı (null)
                    const { r1, r2, total } = computeRoutineTotals(r1d, r2d, rule);
                    rows.push({
                        a: {
                            id: pair.id,
                            name: getPairDisplayName(pair, athletesById),
                            surname: '',
                            club: pair.club || a.club || '',
                            isPair: true,
                            pairName: getPairDisplayName(pair, athletesById),
                        },
                        r1, r2, total,
                        r1d, r2d,
                        s1: r1d?.status, s2: r2d?.status,
                    });
                } else {
                    // Eşleştirilmemiş sporcu — bireysel
                    const res = scores[a.uniqueId] || scores[a.id] || {};
                    const r1d = res.r1 || null;
                    const r2d = res.r2 || null;
                    // DNS/DNF → sıralama dışı (null)
                    const { r1, r2, total } = computeRoutineTotals(r1d, r2d, rule);
                    rows.push({
                        a, r1, r2, total,
                        r1d, r2d,
                        s1: r1d?.status, s2: r2d?.status,
                    });
                }
            });

        } else {
            // --- Bireysel kategori ---
            const filtered = athletes.filter(a => athleteInCategory(a, currentCat));
            filtered.forEach(a => {
                const res = scores[a.uniqueId] || scores[a.id] || {};
                const r1d = res.r1 || null;
                const r2d = res.r2 || null;
                // DNS/DNF → sıralama dışı (null)
                const { r1, r2, total } = computeRoutineTotals(r1d, r2d, rule);
                rows.push({
                    a, r1, r2, total,
                    r1d, r2d,
                    s1: r1d?.status, s2: r2d?.status,
                });
            });
        }

        // Sporcu sıralama mantığı:
        // Puanlı satırlar üstte (eşitler aynı rank), puansızlar altta (rank null)
        const scored   = rows.filter(r => r.r1 != null || r.r2 != null);
        const unscored = rows.filter(r => r.r1 == null && r.r2 == null);
        scored.sort((a, b) => b.total - a.total);
        let lastTotal = null, lastRank = 0;
        scored.forEach((row, i) => {
            if (lastTotal !== null && row.total === lastTotal) row.rank = lastRank;
            else { row.rank = i + 1; lastRank = row.rank; lastTotal = row.total; }
        });
        unscored.forEach(r => { r.rank = null; });
        return [...scored, ...unscored];
    }, [athletes, athletesById, pairs, scores, currentCat, rule, isSync]);

    // ── Kategori satırlarını kur (ekran + yazdırma ortak) ─────────────────
    function buildRows(cat) {
        const cr    = resolveCategoryRules(rules, cat);
        const sync  = cat.type === 'sync';
        const rows  = [];
        const pById = {};
        Object.values(pairs).forEach(p => { if (p?.id) pById[p.id] = p; });
        const catAths = athletes.filter(a => athleteInCategory(a, cat));

        const push = (nameVal, clubVal, res, aRef) => {
            const r1d = res.r1 || null;
            const r2d = res.r2 || null;
            const { r1, r2, total } = computeRoutineTotals(r1d, r2d, cr.scoringRule);
            rows.push({ name: nameVal, club: clubVal, r1, r2, total, a: aRef, s1: r1d?.status, s2: r2d?.status });
        };

        if (sync) {
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

        const scored   = rows.filter(x => x.r1 != null || x.r2 != null).sort((a, b) => b.total - a.total);
        const unscored = rows.filter(x => x.r1 == null && x.r2 == null);
        let lv = null, lr = 0;
        scored.forEach((x, i) => {
            if (lv !== null && x.total === lv) x.rank = lr;
            else { x.rank = i + 1; lr = x.rank; lv = x.total; }
        });
        unscored.forEach(x => { x.rank = null; });
        return { rows: [...scored, ...unscored], cr };
    }

    // Takım sıralaması hangi kategoriden beslenecek?
    // Final kategorilerinde varsayılan kaynak ELEME kategorisidir; finalde
    // kulüp başına 1-2 sporcu kaldığı için finalin kendi puanlarıyla takım
    // kurulamıyordu ve liste boş görünüyordu.
    const teamSrcCat  = resolveTeamSourceCategory(rules, currentCat, categories);
    const teamCr      = teamSrcCat ? resolveCategoryRules(rules, teamSrcCat) : null;
    const teamFromQual = !!teamSrcCat && !!currentCat && teamSrcCat.id !== currentCat.id;
    const showTeamTab = !!teamSrcCat && !!teamCr?.hasTeam;

    // ── Takım Sıralaması ──────────────────────────────────────────────────
    const teamRanking = useMemo(() => {
        if (!showTeamTab) return [];
        // Kaynak kategori final değilse zaten ekrandaki satırlar; eleme ise
        // o kategorinin satırları yeniden kurulur.
        const rows = teamFromQual ? buildRows(teamSrcCat).rows : individualRanking;
        return computeTeamRanking(rows, {
            topN: teamCr.teamTopN,
            minAthletes: teamCr.teamMinAthletes,
            mode: teamCr.teamMode,
            perRoutineMinAthletes: teamCr.teamPerRoutineMinAthletes,
            routineCount: teamCr.routineCount,
            scoringRule: teamCr.teamScoringRule,
        });
    }, [
        individualRanking, currentCat, categories, athletes, pairs, scores,
        rules, showTeamTab, teamFromQual, teamSrcCat?.id,
    ]);

    // ── Formatlama yardımcıları ───────────────────────────────────────────
    const fmtScore = (val, status) => formatResultScore(val, status, '-');

    function fmtDetail(rd) {
        if (!rd || isDNX(rd.status)) return null;
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
        const headers = showR2
            ? ['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'R2', 'Toplam']
            : ['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'Toplam'];
        const rows = individualRanking.map(r => [
            r.rank ?? '—',
            r.a.pairName || getAthleteName(r.a),
            getAthleteClub(r.a) || r.a.club || '',
            fmtScore(r.r1, r.s1),
            ...(showR2 ? [fmtScore(r.r2, r.s2)] : []),
            r.rank != null ? r.total.toFixed(3) : '—',
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentCat.name.substring(0, 30));
        XLSX.writeFile(wb, `${currentCat.name}_Sonuclar.xlsx`);
    }

    function exportAllToExcel() {
        const wb = XLSX.utils.book_new();

        Object.values(categories).forEach(cat => {
            const r = getScoringRule(cat, rules.flow);
            const catIsSync = cat.type === 'sync';
            const aoa = [['Sıra', 'Ad Soyad', 'Kulüp', 'R1', 'R2', 'Toplam']];
            const rows = [];

            const pairsById = {};
            Object.values(pairs).forEach(p => { if (p?.id) pairsById[p.id] = p; });
            const catAths = athletes.filter(a => athleteInCategory(a, cat));

            if (catIsSync) {
                const seen = new Set();
                catAths.forEach(a => {
                    if (a.pairId && pairsById[a.pairId]) {
                        if (seen.has(a.pairId)) return;
                        seen.add(a.pairId);
                        const pair = pairsById[a.pairId];
                        const res = scores[pair.id] || scores[pair.athlete1Id] || scores[pair.athlete2Id] || {};
                        // DNS/DNF → sıralama dışı (null)
                        const { r1, r2, total: tot } = computeRoutineTotals(res.r1, res.r2, r);
                        rows.push({ name: getPairDisplayName(pair, athletesById), club: pair.club || a.club || '', r1, r2, total: tot, s1: res.r1?.status, s2: res.r2?.status });
                    } else {
                        const res = scores[a.uniqueId] || scores[a.id] || {};
                        const { r1, r2, total: tot } = computeRoutineTotals(res.r1, res.r2, r);
                        rows.push({ name: getAthleteName(a), club: getAthleteClub(a), r1, r2, total: tot, s1: res.r1?.status, s2: res.r2?.status });
                    }
                });
            } else {
                catAths.forEach(a => {
                    const res = scores[a.uniqueId] || scores[a.id] || {};
                    const { r1, r2, total: tot } = computeRoutineTotals(res.r1, res.r2, r);
                    rows.push({ name: getAthleteName(a), club: getAthleteClub(a), r1, r2, total: tot, s1: res.r1?.status, s2: res.r2?.status });
                });
            }

            // Ekran tablosuyla aynı sıralama: puanlılar üstte (eşitler aynı derece),
            // puansızlar altta derecesiz.
            const scored   = rows.filter(x => x.r1 != null || x.r2 != null).sort((x, y) => y.total - x.total);
            const unscored = rows.filter(x => x.r1 == null && x.r2 == null);
            let lastTotal = null, lastRank = 0;
            scored.forEach((x, i) => {
                if (lastTotal !== null && x.total === lastTotal) x.rank = lastRank;
                else { x.rank = i + 1; lastRank = x.rank; lastTotal = x.total; }
            });
            unscored.forEach(x => { x.rank = null; });

            [...scored, ...unscored].forEach(x => aoa.push([
                x.rank ?? '—',
                x.name,
                x.club,
                fmtScore(x.r1, x.s1),
                fmtScore(x.r2, x.s2),
                x.rank == null ? '—' : x.total.toFixed(3),
            ]));
            if (aoa.length > 1) {
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                XLSX.utils.book_append_sheet(wb, ws, cat.name.substring(0, 30));
            }
        });

        XLSX.writeFile(wb, `${comp?.name || 'Yarisma'}_Tum_Sonuclar.xlsx`);
    }

    /**
     * TCF resmî sonuç raporu — yazdır / PDF olarak kaydet.
     *
     * Biçim eski TCF sisteminden alındı: A4 sayfa, kurumsal kırmızı başlık,
     * kategori başına ayrı sayfa, altta imza satırı. Üstüne TCF logosu ve
     * takım sonuçları eklendi.
     *
     * @param {'current'|'all'} scope  Yalnızca seçili kategori mi, tümü mü
     */
    function printReport(scope) {
        const cats = scope === 'current'
            ? (selectedCatId && categories[selectedCatId] ? [categories[selectedCatId]] : [])
            : Object.values(categories);

        if (cats.length === 0) {
            toast('Yazdırılacak kategori yok.', 'warning');
            return;
        }

        // Firebase'den gelen isimler HTML'e gömülüyor — kaçış şart
        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));

        const fmtP = (val, status) => formatResultScore(val, status, '-');
        const medal = (rank) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : (rank ?? '—');

        // ── Kategori satırlarını kur (ekrandakiyle aynı mantık) ──────────
        // ── Sayfa iskeleti ───────────────────────────────────────────────
        const page = (cat, subtitle, tableHtml, note) => `
            <div class="page">
                <div class="header">
                    <img class="logo" src="${window.location.origin}/tcf-logo.png" alt="TCF" />
                    <div class="head-text">
                        <div class="comp-name">${esc(comp?.name || '')}</div>
                        <h1 class="cat-name">${esc(cat.name)}</h1>
                        <div class="sub-header">${esc(subtitle)}</div>
                    </div>
                </div>
                ${note ? `<div class="note">${esc(note)}</div>` : ''}
                ${tableHtml}
                <div class="footer">
                    <div>TCF TRAMBOLİN CİMNASTİK SİSTEMİ</div>
                    <div>Oluşturulma: ${new Date().toLocaleString('tr-TR')}</div>
                </div>
                <div class="signs">
                    <div class="sign"><span></span>Başhakem</div>
                    <div class="sign"><span></span>Üst Jüri</div>
                    <div class="sign"><span></span>Teknik Sorumlu</div>
                </div>
            </div>`;

        let body = '';

        cats.forEach(cat => {
            const { rows, cr } = buildRows(cat);
            if (rows.length === 0) return;

            const showR2  = cr.routineCount >= 2;
            const totLbl  = cr.scoringRule === 'max' ? 'GEÇERLİ' : 'TOPLAM';
            const ruleTxt = cr.scoringRule === 'max' ? 'Geçerli puan = MAX(1. Seri, 2. Seri)' : 'Toplam = 1. Seri + 2. Seri';

            // ── Bireysel ────────────────────────────────────────────────
            const indTable = `
                <table>
                    <thead>
                        <tr>
                            <th class="c" style="width:52px">SIRA</th>
                            <th>AD SOYAD</th>
                            <th>KULÜP</th>
                            <th class="c" style="width:82px">1. SERİ</th>
                            ${showR2 ? '<th class="c" style="width:82px">2. SERİ</th>' : ''}
                            <th class="c" style="width:92px">${totLbl}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(x => `
                            <tr class="${x.rank === 1 ? 'gold' : x.rank === 2 ? 'silver' : x.rank === 3 ? 'bronze' : ''}">
                                <td class="rank-col">${medal(x.rank)}</td>
                                <td class="name-col">${esc(x.name)}</td>
                                <td class="club-col">${esc(x.club || '—')}</td>
                                <td class="score-col">${fmtP(x.r1, x.s1)}</td>
                                ${showR2 ? `<td class="score-col">${fmtP(x.r2, x.s2)}</td>` : ''}
                                <td class="total-col">${x.rank == null ? '—' : x.total.toFixed(3)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
            body += page(cat, 'RESMÎ SONUÇ LİSTESİ — BİREYSEL', indTable, ruleTxt);

            // ── Takım ───────────────────────────────────────────────────
            // Final kategorilerinde takım puanı kural gereği ELEME
            // kategorisinden gelir (ekrandaki davranışın aynısı).
            const srcCat = resolveTeamSourceCategory(rules, cat, categories);
            if (!srcCat) return;
            const tcr = resolveCategoryRules(rules, srcCat);
            if (!tcr.hasTeam) return;
            const fromQual = srcCat.id !== cat.id;
            const teamRows = fromQual ? buildRows(srcCat).rows : rows;

            const teams = computeTeamRanking(teamRows, {
                topN: tcr.teamTopN,
                minAthletes: tcr.teamMinAthletes,
                mode: tcr.teamMode,
                perRoutineMinAthletes: tcr.teamPerRoutineMinAthletes,
                routineCount: tcr.routineCount,
                scoringRule: tcr.teamScoringRule,
            });
            if (teams.length === 0) return;

            const teamNote = (teams[0].perRoutine
                ? `Takım puanı = her serinin en iyi ${tcr.teamTopN} puanı toplanır · en az ${tcr.teamMinAthletes} sporcu`
                : tcr.teamScoringRule === 'max'
                    ? `Takım puanı = en iyi ${tcr.teamTopN} sporcunun EN YÜKSEK serisi · en az ${tcr.teamMinAthletes} sporcu`
                    : `Takım puanı = en iyi ${tcr.teamTopN} sporcunun toplamı · en az ${tcr.teamMinAthletes} sporcu`)
                + ' · Üstü çizili puanlar takım toplamına girmez'
                + (fromQual ? ` · Kaynak: ${srcCat.name} (eleme) sonuçları` : '');

            const teamTable = `
                <table>
                    <thead>
                        <tr>
                            <th class="c" style="width:48px">SIRA</th>
                            <th style="width:150px">KULÜP</th>
                            ${teams[0].routines.map(rt => `<th>${rt.label.toUpperCase()} — PUANA SAYILANLAR</th>`).join('')}
                            <th class="c" style="width:84px">TOPLAM</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${teams.map((t, i) => `
                            <tr class="${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">
                                <td class="rank-col">${medal(i + 1)}</td>
                                <td class="name-col">${esc(t.club)}<div class="club-col">${t.members.length} sporcu</div></td>
                                ${t.routines.map(rt => `
                                    <td class="picks">
                                        ${rt.picks.length === 0
                                            ? '<span class="muted">—</span>'
                                            : rt.picks.map(pk => `<div class="${pk.counted ? '' : 'off'}"><span>${esc(pk.name)}</span><b>${pk.score.toFixed(3)}</b></div>`).join('')}
                                        <div class="sub"><span>Ara toplam</span><b>${rt.subtotal.toFixed(3)}</b></div>
                                    </td>`).join('')}
                                <td class="total-col">${t.teamTotal.toFixed(3)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
            body += page(
                cat,
                fromQual ? 'RESMÎ SONUÇ LİSTESİ — TAKIM (ELEME SONUÇLARINA GÖRE)'
                         : 'RESMÎ SONUÇ LİSTESİ — TAKIM',
                teamTable, teamNote,
            );
        });

        if (!body) {
            toast('Yazdırılacak sonuç bulunamadı.', 'warning');
            return;
        }

        const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>${esc(comp?.name || 'Sonuçlar')} — TCF Resmî Sonuçlar</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  body { font-family:'Outfit',sans-serif; margin:0; color:#1e293b;
         -webkit-print-color-adjust:exact; print-color-adjust:exact; background:#e2e8f0; }
  .page { width:210mm; min-height:297mm; padding:12mm; margin:0 auto 10px; background:#fff;
          box-sizing:border-box; page-break-after:always; display:flex; flex-direction:column; }
  .page:last-child { page-break-after:auto; }

  .header { background:#E30613; color:#fff; padding:14px 18px; border-radius:12px;
            margin-bottom:18px; display:flex; align-items:center; gap:16px; }
  .logo { width:64px; height:64px; background:#fff; border-radius:50%; padding:4px; flex-shrink:0; object-fit:contain; }
  .head-text { text-align:left; min-width:0; }
  .comp-name { font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:1px; opacity:.95; }
  .cat-name  { font-size:26px; font-weight:900; margin:2px 0 0; }
  .sub-header{ font-size:11px; opacity:.9; margin-top:3px; font-weight:600; letter-spacing:1px; }

  .note { font-size:10px; color:#64748b; margin-bottom:8px; font-weight:600; }

  table { width:100%; border-collapse:separate; border-spacing:0 5px; }
  th { text-align:left; font-size:9.5px; font-weight:800; color:#64748b; text-transform:uppercase;
       letter-spacing:.8px; padding:0 10px 7px; border-bottom:2px solid #e2e8f0; }
  th.c { text-align:center; }
  td { background:#f8fafc; padding:8px 10px; font-size:12px; font-weight:600; color:#334155;
       border:1px solid #e2e8f0; border-width:1px 0; }
  tr td:first-child { border-left:1px solid #e2e8f0; border-radius:8px 0 0 8px; }
  tr td:last-child  { border-right:1px solid #e2e8f0; border-radius:0 8px 8px 0; }

  tr.gold   td { background:#fffbeb; border-color:#fcd34d; }
  tr.silver td { background:#f8fafc; border-color:#cbd5e1; }
  tr.bronze td { background:#fff7ed; border-color:#fdba74; }

  .rank-col  { font-weight:900; color:#E30613; font-size:14px; text-align:center; }
  .name-col  { font-size:13px; font-weight:800; color:#0f172a; }
  .club-col  { font-weight:500; color:#64748b; font-size:10.5px; text-transform:uppercase; }
  .score-col { text-align:center; font-family:'Space Mono',monospace; font-size:12px; }
  .total-col { text-align:center; font-weight:900; color:#000; font-size:13px; background:#eef2f7; }
  .picks { font-size:10.5px; }
  .picks > div { display:flex; justify-content:space-between; gap:8px; padding:1px 0; }
  .picks > div > b { font-family:'Space Mono',monospace; font-weight:700; color:#0f172a; }
  .picks .sub { margin-top:3px; padding-top:3px; border-top:1px solid #cbd5e1; font-weight:800; color:#E30613; }
  .picks .muted { color:#94a3b8; }
  /* Takım puanına sayılmayan sporcu: listede görünür ama üstü çizili */
  .picks > div.off, .picks > div.off > b { color:#94a3b8; text-decoration:line-through; }

  .footer { margin-top:auto; padding-top:14px; border-top:1px solid #e2e8f0;
            display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; font-weight:500; }
  .signs { display:flex; justify-content:space-between; gap:24px; margin-top:26px; }
  .sign { flex:1; text-align:center; font-size:10px; color:#475569; font-weight:600; }
  .sign span { display:block; border-top:1px solid #94a3b8; margin-bottom:5px; height:34px; }

  @media print { body { background:#fff; } .page { margin:0; } }
</style></head>
<body>${body}<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;

        const w = window.open('', '_blank');
        if (!w) { toast('Açılır pencere engellendi — tarayıcı iznini kontrol edin.', 'error'); return; }
        w.document.write(html);
        w.document.close();
    }

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
                    <button className="btn btn-sm" onClick={() => printReport('current')} disabled={!currentCat}
                        style={{ background: '#E30613', color: 'white', opacity: currentCat ? 1 : 0.5 }}
                        title="Seçili kategorinin bireysel + takım sonuçları">
                        <i className="material-icons-round">picture_as_pdf</i> PDF — Bu Kategori
                    </button>
                    <button className="btn btn-sm" onClick={() => printReport('all')}
                        style={{ background: '#1e293b', color: 'white' }}
                        title="Tüm kategorilerin bireysel + takım sonuçları">
                        <i className="material-icons-round">picture_as_pdf</i> PDF — Tümü
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
                    {showTeamTab && (
                        <button className={'btn ' + (activeTab === 'team' ? 'btn-primary' : 'btn-outline')}
                            onClick={() => setActiveTab('team')}>
                            TAKIM SIRALAMASI
                        </button>
                    )}
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

                        {currentCat && activeTab === 'team' && !showTeamTab && (
                            <div className="text-center text-muted" style={{ padding: 40 }}>
                                Bu kategoride takım sıralaması yapılmaz.
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
                                            {showR2 && <th style={{ width: 130, textAlign: 'right' }}>R2</th>}
                                            <th style={{ width: 150, textAlign: 'right' }}>
                                                {rule === 'max' ? 'GEÇERLİ PUAN' : 'TOPLAM'}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {individualRanking.length === 0 && (
                                            <tr>
                                                <td colSpan={showR2 ? 6 : 5} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                                                    {isSync
                                                        ? 'Henüz sonuç yok. Çift oluşturun ve puanlayın.'
                                                        : 'Henüz yayınlanmış sonuç yok.'}
                                                </td>
                                            </tr>
                                        )}
                                        {individualRanking.map((row, i) => {
                                            const rank   = row.rank;          // null = puansız
                                            const medalC = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '';
                                            const isMedal = rank != null && rank <= 3;
                                            const detail1 = fmtDetail(row.r1d);
                                            const detail2 = fmtDetail(row.r2d);
                                            return (
                                                <tr key={row.a.id}
                                                    style={isMedal ? { background: `${medalC}08` } : {}}>
                                                    <td style={{
                                                        fontFamily: "'Space Mono',monospace",
                                                        fontWeight: 700, fontSize: '1.15rem', color: medalC || 'inherit',
                                                    }}>
                                                        {isMedal
                                                            ? <i className="material-icons-round" style={{ fontSize: 22, color: medalC }}>
                                                                {rank === 1 ? 'looks_one' : rank === 2 ? 'looks_two' : 'looks_3'}
                                                              </i>
                                                            : (rank ?? '—')}
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            {row.a.isPair && (
                                                                <i className="material-icons-round" style={{ fontSize: 14, color: '#c084fc' }}>sync</i>
                                                            )}
                                                            {row.a.pairName || getAthleteName(row.a)}
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
{showR2 && (
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
)}
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{
                                                            fontFamily: "'Space Mono',monospace",
                                                            fontSize: '1.2rem', fontWeight: 700,
                                                            color: medalC || '#7C87D8',
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
                        {currentCat && activeTab === 'team' && showTeamTab && (
                            <div>
                                {teamFromQual && (
                                    <div style={{
                                        margin: '14px 16px 4px', padding: '10px 14px', borderRadius: 10,
                                        background: 'rgba(124,135,216,0.10)',
                                        border: '1px solid rgba(124,135,216,0.28)',
                                        color: '#9aa4e6', fontSize: '0.82rem', fontWeight: 600,
                                    }}>
                                        Takım sıralaması <b>{teamSrcCat.name}</b> (eleme) puanlarından
                                        hesaplanır — finalde kulüp başına yeterli sporcu kalmaz.
                                    </div>
                                )}
                                {teamRanking.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                                        Takım oluşturacak kadar sporcusu olan kulüp yok
                                        (en az {teamCr.teamMinAthletes} puan almış sporcu gerekir).
                                    </div>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {teamRanking.map((t, i) => {
                                        const medal = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '';
                                        return (
                                            <div key={t.club} style={{
                                                background: medal ? `${medal}0D` : 'rgba(255,255,255,0.03)',
                                                border: `1px solid ${medal ? `${medal}44` : 'rgba(255,255,255,0.07)'}`,
                                                borderRadius: 14, overflow: 'hidden',
                                            }}>
                                                {/* Üst şerit: sıra, kulüp, toplam */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 14,
                                                    padding: '12px 18px',
                                                    background: medal ? `${medal}12` : 'rgba(255,255,255,0.02)',
                                                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                }}>
                                                    <div style={{
                                                        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        background: medal || 'rgba(255,255,255,0.08)',
                                                        color: medal ? '#0f172a' : '#94a3b8',
                                                        fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: '1rem',
                                                    }}>
                                                        {i + 1}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontWeight: 800, fontSize: '1.05rem', color: '#f1f5f9',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        }}>
                                                            {t.club}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 1 }}>
                                                            {t.members.length} sporcu kayıtlı
                                                        </div>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#64748b', letterSpacing: 1, fontWeight: 700 }}>
                                                            TAKIM TOPLAMI
                                                        </div>
                                                        <div style={{
                                                            fontFamily: "'Space Mono',monospace", fontSize: '1.5rem',
                                                            fontWeight: 700, color: medal || 'var(--accent-secondary)', lineHeight: 1.1,
                                                        }}>
                                                            {t.teamTotal.toFixed(3)}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Seri blokları: hangi sporcunun puanı hangi seriden geldi */}
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: `repeat(${t.routines.length}, 1fr)`,
                                                    gap: 1, background: 'rgba(255,255,255,0.06)',
                                                }}>
                                                    {t.routines.map(rt => (
                                                        <div key={rt.key} style={{ background: 'rgba(10,14,32,0.55)', padding: '12px 18px' }}>
                                                            <div style={{
                                                                display: 'flex', justifyContent: 'space-between',
                                                                alignItems: 'baseline', marginBottom: 8,
                                                            }}>
                                                                <span style={{
                                                                    fontSize: '0.7rem', fontWeight: 800, letterSpacing: 1.2,
                                                                    color: rt.key === 'r1' ? 'var(--accent-primary)' : 'var(--accent-secondary)',
                                                                }}>
                                                                    {rt.label.toUpperCase()}
                                                                </span>
                                                                <span style={{
                                                                    fontFamily: "'Space Mono',monospace", fontWeight: 700,
                                                                    fontSize: '1rem', color: '#e2e8f0',
                                                                }}>
                                                                    {rt.subtotal.toFixed(3)}
                                                                </span>
                                                            </div>
                                                            {rt.picks.length === 0 ? (
                                                                <div style={{ color: '#475569', fontSize: '0.8rem' }}>
                                                                    Bu seriden puan sayılmadı
                                                                </div>
                                                            ) : rt.picks.map((pk, idx) => (
                                                                <div key={idx} style={{
                                                                    display: 'flex', justifyContent: 'space-between',
                                                                    alignItems: 'center', gap: 10,
                                                                    padding: '3px 0', fontSize: '0.84rem',
                                                                    borderBottom: idx < rt.picks.length - 1 ? '1px dashed rgba(255,255,255,0.06)' : 'none',
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
                                                                        fontFamily: "'Space Mono',monospace",
                                                                        color: pk.counted ? '#94a3b8' : '#475569',
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
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
