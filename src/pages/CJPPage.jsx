/**
 * CJPPage.jsx
 * Mevcut cjp.html — Başhakem (CJP) Paneli
 *
 * Kritik iş mantığı (aynen korundu):
 * - Sol sidebar: Kategoriye göre sporcu listesi, arama, sıra bilgisi
 * - Sağ HUD: E skor (hakemlerden otomatik), D, T, H, S, P girişleri
 * - Rutin sekmeleri (1. Seri / 2. Seri)
 * - Sporcu sahaya çağırma → activeContext güncelleme
 * - Puanları yayınlama (publishResult)
 * - Kilit sistemi: yayınlanan skor otomatik kilitlenir
 * - E skor = hakemlerin toplamından orta değer hesabı
 * - Şifre kapısı: PasswordGate bileşeni
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, get, set, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { DataService, getAthleteName, getAthleteClub } from '../lib/DataService';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import PasswordGate from '../components/PasswordGate';

// ── E Skor Hesaplama (FIG kuralı — HTML cjp.html ile birebir aynı) ───────
// Her element için 6 hakemden en yüksek 2 + en düşük 2 kesilir, kalan toplanır.
// Landing ayrıca aynı şekilde kesilir.
// Not: JudgeCockpitPage `deductions` alanı olarak yazar (HTML ile uyumlu).
function calcEScore(judgesData, elementCount = 10) {
    const base = elementCount * 2;

    function trimDeductions(arr) {
        if (arr.length >= 6) {
            arr.sort((a, b) => a - b);
            arr.pop(); arr.pop();     // 2 yüksek
            arr.shift(); arr.shift(); // 2 düşük
        } else if (arr.length >= 4) {
            arr.sort((a, b) => a - b);
            arr.pop();
            if (arr.length > 2) arr.pop();
            arr.shift();
            if (arr.length > 2) arr.shift();
        }
        return arr.reduce((a, b) => a + b, 0);
    }

    let totalDeduction = 0;

    // Her element için per-element trimming
    // Alan adı: `deductions` (HTML CJP ile uyumlu, eski `scores` değil)
    for (let elIdx = 0; elIdx < elementCount; elIdx++) {
        const elDeducts = [];
        for (let j = 1; j <= 6; j++) {
            const jData = judgesData[`e${j}`];
            if (jData) {
                // `deductions` önce, geriye dönük uyumluluk için `scores` de dene
                const arr = jData.deductions || jData.scores;
                if (arr && arr[elIdx] !== undefined) {
                    elDeducts.push(parseFloat(arr[elIdx]) || 0);
                }
            }
        }
        totalDeduction += trimDeductions(elDeducts);
    }

    // Landing trimming
    const landingArr = [];
    for (let j = 1; j <= 6; j++) {
        const jData = judgesData[`e${j}`];
        if (jData && jData.landing !== undefined && jData.landing !== null && jData.landing !== '') {
            landingArr.push(parseFloat(jData.landing) || 0);
        }
    }
    totalDeduction += trimDeductions(landingArr);

    return Math.max(0, base - totalDeduction);
}

// ── D Skor (D hakeminden okur — key: 'd', alan: 'val') ───────────────────
// Not: HTML CJP judges['d'].val formatı. JudgeCockpitPage de 'd' key + val yazar.
function getDScoreFromJudge(judgesData) {
    const dJudge = judgesData?.d;
    if (dJudge && dJudge.val !== undefined && dJudge.val !== '') {
        return parseFloat(dJudge.val) || 0;
    }
    return null; // null = judge verisi yok, manuel giriş kullanılır
}

export default function CJPPage() {
    const [params] = useSearchParams();
    const { checkJudgeAccess, saveJudgeSession, isJudgeSessionValid, startInactivityTimer, clearJudgeSession } = useAuth();
    const { toast, confirm } = useNotification();

    const compId = params.get('comp') || localStorage.getItem('tra_active_comp');
    const panelParam = params.get('panel') || localStorage.getItem('cjp_panel') || 'A';

    // ── Ekran Kilidi ──────────────────────────────────────────────────────
    const [unlocked, setUnlocked] = useState(false);
    const [noPassword, setNoPassword] = useState(false);
    const [currentPanel, setCurrentPanel] = useState(panelParam);

    // ── Veri ─────────────────────────────────────────────────────────────
    const [allAthletes, setAllAthletes] = useState([]);
    const [allCategories, setAllCategories] = useState({});
    const [juryPanels, setJuryPanels] = useState({});
    const [competitionResults, setCompetitionResults] = useState({});
    const [judgesData, setJudgesData] = useState({});

    // ── Seçimler ─────────────────────────────────────────────────────────
    const [selectedCatId, setSelectedCatId] = useState('');
    const [selected, setSelected] = useState(null);    // Seçili sporcu
    const [nextAth, setNextAth] = useState(null);
    const [activeRoutine, setActiveRoutine] = useState(1); // 1 | 2

    // ── Girdiler ─────────────────────────────────────────────────────────
    const [inpT,  setInpT]  = useState('');
    const [inpH,  setInpH]  = useState(''); // Bireysel: tek H | Sync: H1
    const [inpH2, setInpH2] = useState(''); // Sync: H2
    const [inpS,  setInpS]  = useState(''); // Sync: S (formülde ×2 kullanılır)
    const [inpP,  setInpP]  = useState('');
    const [inpDp, setInpDp] = useState('');
    const [elementCount, setElementCount] = useState(10);
    const [currentStatus, setCurrentStatus] = useState(null); // 'DNS' | 'DNF' | null

    // ── UI durum ─────────────────────────────────────────────────────────
    const [isLocked, setIsLocked] = useState(false);
    const [liveActiveAthId, setLiveActiveAthId] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showUnlockPopup, setShowUnlockPopup] = useState(false);
    const [showElementPopup, setShowElementPopup] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [allPairs, setAllPairs] = useState({});  // pairId → pair obj

    const dsRef = useRef(null);
    const unsubRefs = useRef([]);

    // D input için state — D hakeminden gelmezse manuel girilebilir
    const [dInput, setDInput] = useState('');

    // ── Hesaplanan değerler ───────────────────────────────────────────────
    const eScore = calcEScore(judgesData, elementCount);

    // D: önce D hakeminden oku, yoksa manuel girişi kullan
    const dFromJudge = getDScoreFromJudge(judgesData);
    const dVal = dFromJudge !== null ? dFromJudge : (parseFloat(dInput) || 0);

    const tVal   = parseFloat(inpT)  || 0;
    const h1Val  = parseFloat(inpH)  || 0; // Bireysel: H | Sync: H1
    const h2Val  = parseFloat(inpH2) || 0; // Sync: H2
    const sVal   = parseFloat(inpS)  || 0;
    const pVal   = parseFloat(inpP)  || 0;
    const dpVal  = parseFloat(inpDp) || 0;

    // Sync mi? Kategoriye göre belirlenir
    const isSync = selected?.catType === 'sync';

    // Hesaplanan ara değerler
    const hEffective = isSync ? (h1Val + h2Val) / 2 : h1Val; // Sync: (H1+H2)/2 | Bireysel: H
    const sEffective = isSync ? sVal * 2 : 0;                 // Sync: S×2 | Bireysel: 0

    // Total (orijinal HTML cjp.html formülü):
    //   Bireysel → E + H + D + T - P - DP          (H pozitif, EKLENIR)
    //   Sync     → E + H + D + (S×2) - P - DP      (T=0, S×2 eklenir, H yine pozitif)
    // hEffective = Bireysel: H | Sync: (H1+H2)/2
    const totalScore = Math.max(0,
        isSync
            ? eScore + hEffective + dVal + sEffective - pVal - dpVal
            : eScore + h1Val      + dVal + tVal       - pVal - dpVal
    );

    // ── Şifre kapısı ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;
        (async () => {
            if (isJudgeSessionValid(compId, currentPanel, 'cjp')) {
                setUnlocked(true);
                return;
            }
            const result = await checkJudgeAccess(compId, currentPanel, 'cjp');
            if (result === 'no_password') {
                setNoPassword(true);
                setUnlocked(true);
            }
        })();
    }, [compId, currentPanel]);

    // ── Init: veriler ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!unlocked || !compId) return;

        dsRef.current = new DataService(compId);

        // 1. Yarışma verisi (kategoriler + sporcular + çiftler)
        const compUnsub = onValue(ref(db, `competitions/${compId}`), snap => {
            const comp = snap.val();
            if (!comp) return;

            const cats = comp.categories || {};
            const globalAthletes = comp.athletes || {};
            const panels = comp.juryPanels || {};

            setAllCategories(cats);
            setJuryPanels(panels);

            // Sporcu listesi: startList > globalAthletes filtresi
            const list = [];
            Object.values(cats).forEach(cat => {
                const addedIds = new Set();
                const finalAthletes = [];

                // startList öncelikli
                if (cat.startList) {
                    const sl = Array.isArray(cat.startList) ? cat.startList : Object.values(cat.startList);
                    sl.forEach(a => { if (a?.id) { finalAthletes.push(a); addedIds.add(a.id); } });
                }
                // Genel kayıtlı sporcular
                Object.values(globalAthletes).forEach(ath => {
                    if ((ath.category === cat.id || ath.categoryId === cat.id) && !addedIds.has(ath.id)) {
                        finalAthletes.push(ath);
                        addedIds.add(ath.id);
                    }
                });
                // Kategori içi sporcular (legacy)
                if (cat.athletes) {
                    const catAth = Array.isArray(cat.athletes) ? cat.athletes : Object.values(cat.athletes);
                    catAth.forEach(ath => {
                        if (ath && !addedIds.has(ath.id)) { finalAthletes.push(ath); addedIds.add(ath.id); }
                    });
                }

                finalAthletes.forEach(ath => {
                    if (!ath) return;
                    // Her zaman güncel globalAthletes verisini önce al
                    // (startList anlık görüntüde eski/boş isimler olabilir)
                    const fresh = globalAthletes[ath.id] || {};
                    const mergedName    = (ath.name    || '').trim() || (fresh.name    || fresh.ad      || fresh.firstName || '');
                    const mergedSurname = (ath.surname || '').trim() || (fresh.surname || fresh.soyad   || fresh.lastName  || '');
                    const mergedClub    = (ath.club    || '').trim() || (fresh.club    || fresh.kulup   || '');
                    list.push({
                        ...ath,
                        name: mergedName,
                        surname: mergedSurname,
                        club: mergedClub,
                        catId: cat.id, catName: cat.name, catType: cat.type ?? null, uniqueId: ath.id,
                    });
                });
            });

            setAllAthletes(list);
        });

        // 2. Sonuçları dinle
        const resUnsub = dsRef.current.listenResults(res => setCompetitionResults(res || {}));

        // 3. Canlı hakem verisi (panel-specific)
        const judgesUnsub = onValue(
            ref(db, `live/${compId}/panels/${currentPanel}/scores/judges`),
            snap => setJudgesData(snap.val() || {})
        );

        // 4. Active context (sahada kim var)
        const ctxUnsub = dsRef.current.listenActiveContext(currentPanel, ctx => {
            if (ctx?.current) {
                setLiveActiveAthId(ctx.current.uniqueId || ctx.current.id);
            }
        });

        // 5. Sync çiftleri dinle
        const pairsUnsub = dsRef.current.listenPairs(pairs => setAllPairs(pairs || {}));

        unsubRefs.current = [compUnsub, resUnsub, judgesUnsub, ctxUnsub, pairsUnsub];
        return () => unsubRefs.current.forEach(u => u && u());
    }, [unlocked, compId, currentPanel]);

    // ── İnaktivite ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!unlocked) return;
        startInactivityTimer(() => { clearJudgeSession(); setUnlocked(false); });
    }, [unlocked]);

    // ── Sporcu seçimi ─────────────────────────────────────────────────────
    function selectAthlete(ath) {
        const list = filteredAthletes;
        const idx = list.findIndex(a => a.uniqueId === ath.uniqueId);
        setNextAth(list[idx + 1] || null);
        setSelected(ath);
        setIsLocked(false);
        setCurrentStatus(null);
        setInpT(''); setInpH(''); setInpH2(''); setInpS(''); setInpP(''); setInpDp('');
        setDInput('');
        setElementCount(10);
        setActiveRoutine(1);

        // Mevcut sonuçlara bak
        const athRes = competitionResults[ath.uniqueId] || {};
        if (!athRes.r1) setActiveRoutine(1);
        else if (!athRes.r2) setActiveRoutine(2);
    }

    // Seçili sporcu değişince veya sonuçlar güncellenince draft/result yükle
    useEffect(() => {
        if (!selected || !dsRef.current) return;
        loadRoutineData(activeRoutine);
    }, [selected, activeRoutine, competitionResults]);

    async function loadRoutineData(rNum) {
        if (!selected || !dsRef.current) return;
        const athRes = competitionResults[selected.uniqueId] || {};
        const result = athRes[`r${rNum}`];

        if (result) {
            // Yayınlanmış sonuç → yükle ve kilitle
            setInpT(result.t != null ? String(result.t) : '');
            setInpH(result.h1 != null ? String(result.h1) : result.h != null ? String(result.h) : '');
            setInpH2(result.h2 != null ? String(result.h2) : '');
            // S yayınlanan değer zaten ×2 olarak kaydedildi, geri çevirip göster
            setInpS(result.sRaw != null ? String(result.sRaw) : result.s != null ? String(result.s) : '');
            setInpP(result.p != null ? String(result.p) : '');
            setInpDp(result.dp != null ? String(result.dp) : '');
            setDInput(result.d != null ? String(result.d) : '');
            if (result.elementDeductions?.length) setElementCount(result.elementDeductions.length);
            setIsLocked(true);
        } else {
            // Taslak
            try {
                const draft = await dsRef.current.getDraft(selected.uniqueId, rNum);
                if (draft?.inputs) {
                    const inp = draft.inputs;
                    setInpT(inp.t || '');
                    setInpH(inp.h || '');
                    setInpH2(inp.h2 || '');
                    setInpS(inp.s || '');
                    setInpP(inp.p || '');
                    setInpDp(inp.dp || '');
                    setDInput(inp.d != null ? String(inp.d) : '');
                }
                if (draft?.elementCount) setElementCount(draft.elementCount);
            } catch {}
            setIsLocked(false);
        }
    }

    // ── Taslak kaydet (oninput) ───────────────────────────────────────────
    async function saveDraft() {
        if (!selected || !dsRef.current || isLocked) return;
        await dsRef.current.saveDraft(selected.uniqueId, activeRoutine, {
            inputs: { t: inpT, h: inpH, h2: inpH2, s: inpS, p: inpP, dp: inpDp, d: dInput },
            elementCount,
        });
    }

    // ── Canlı Önizleme — Scoreboard'a anlık yaz (HTML calcWithoutSave eşleniği) ──
    // Hakem verisi veya CJP inputları değişince panele isLive:true yazar
    useEffect(() => {
        if (!selected || !compId || isLocked) return;
        const hasStarted =
            Object.keys(judgesData).length > 0 ||
            dVal > 0 || tVal > 0 || h1Val > 0 || h2Val > 0 || sVal > 0 || pVal > 0 || dpVal > 0 || currentStatus;
        if (!hasStarted) return;

        const previewData = {
            isLive: true,
            athleteId: selected.uniqueId,
            athleteName: getAthleteName(selected),
            club: getAthleteClub(selected),
            routine: activeRoutine,
            panel: currentPanel,
            e: parseFloat(eScore.toFixed(2)),
            d: dVal,
            t: isSync ? 0 : tVal,
            h: parseFloat(hEffective.toFixed(3)),
            h1: isSync ? h1Val : null,   // undefined → null (Firebase undefined kabul etmez)
            h2: isSync ? h2Val : null,
            s: parseFloat(sEffective.toFixed(3)),
            sRaw: isSync ? sVal : 0,
            p: pVal, dp: dpVal,
            total: parseFloat(totalScore.toFixed(3)),
            status: currentStatus || null,
            isPair: isSync && !!selected?.pairId,
            pairName: selected?.pairName || null,
        };
        set(ref(db, `live/${compId}/panels/${currentPanel}/scores/current`), previewData).catch(() => {});
    }, [judgesData, inpT, inpH, inpH2, inpS, inpP, inpDp, dInput, currentStatus, elementCount]);

    // ── Sahaya Çağır ──────────────────────────────────────────────────────
    async function callToField() {
        if (!selected || !dsRef.current) return;
        setIsLocked(false);

        const displayLabel = getAthleteName(selected);
        await dsRef.current.updateActiveContext(currentPanel, {
            current: {
                ...selected,
                displayName: displayLabel,
            },
            next: nextAth,
            routine: activeRoutine,
            categoryId: selected.catId,
            timestamp: Date.now(),
        });

        // Hakem ekranlarını temizle
        await remove(ref(db, `live/${compId}/panels/${currentPanel}/scores/judges`));
        setJudgesData({});

        toast(`${displayLabel} sahaya çağrıldı — ${activeRoutine}. Seri`, 'success');
    }

    // ── Yayınla ───────────────────────────────────────────────────────────
    async function publishScore() {
        if (!selected || !dsRef.current) return;

        if (currentStatus === 'DNS' || currentStatus === 'DNF') {
            const ok = await confirm('Durum Yayınla', `${getAthleteName(selected)} — ${currentStatus} olarak yayınlanacak. Onaylıyor musunuz?`);
            if (!ok) return;

            setIsSubmitting(true);
            try {
                await dsRef.current.publishResult(selected.uniqueId, activeRoutine, {
                    d: 0, e: 0, t: 0, h: 0, h1: 0, h2: 0, s: 0, sRaw: 0, p: 0, dp: 0, total: 0,
                    status: currentStatus,
                    judges: {},
                });
                toast(`${currentStatus} yayınlandı.`, 'info');
                setIsLocked(true);
                if (activeRoutine === 1) setActiveRoutine(2);
            } catch (e) {
                toast('Yayınlama hatası: ' + e.message, 'error');
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        const ok = await confirm('Puanı Yayınla',
            `${getAthleteName(selected)} — ${activeRoutine}. Seri\nToplam: ${totalScore.toFixed(3)}\n\nYayınlamak istediğinize emin misiniz?`
        );
        if (!ok) return;

        setIsSubmitting(true);
        try {
            await dsRef.current.publishResult(selected.uniqueId, activeRoutine, {
                d: dVal,
                e: parseFloat(eScore.toFixed(2)),
                t: isSync ? 0 : tVal,
                h: parseFloat(hEffective.toFixed(3)),
                h1: isSync ? h1Val : null,   // undefined → null
                h2: isSync ? h2Val : null,
                s: parseFloat(sEffective.toFixed(3)),
                sRaw: isSync ? sVal : 0,
                p: pVal,
                dp: dpVal,
                total: parseFloat(totalScore.toFixed(3)),
                status: 'published',
                judges: judgesData,
                elementCount,
            });
            // Flash ekranına bildir (ResultsLivePage dinler)
            const displayLabel = getAthleteName(selected);
            await set(ref(db, `live/${compId}/scores/current`), {
                athleteName: displayLabel,
                club: getAthleteClub(selected),
                d: dVal,
                e: parseFloat(eScore.toFixed(2)),
                t: isSync ? 0 : tVal,
                h: parseFloat(hEffective.toFixed(3)),
                s: parseFloat(sEffective.toFixed(3)),
                sRaw: isSync ? sVal : 0,
                p: pVal,
                total: parseFloat(totalScore.toFixed(3)),
                isPair: isSync && !!selected?.pairId,
                pairName: selected?.pairName || null,
                timestamp: Date.now(),
            });
            toast('Puan yayınlandı!', 'success');
            setIsLocked(true);
            if (activeRoutine === 1) setActiveRoutine(2);
        } catch (e) {
            toast('Yayınlama hatası: ' + e.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    }

    // ── Sıfırla ───────────────────────────────────────────────────────────
    function resetScores() {
        setInpT(''); setInpH(''); setInpH2(''); setInpS(''); setInpP(''); setInpDp('');
        setDInput('');
        setJudgesData({});
        setCurrentStatus(null);
        setIsLocked(false);
    }

    // ── Filtre ────────────────────────────────────────────────────────────
    const selectedCat = allCategories[selectedCatId] || null;
    const isSyncCategory = selectedCat?.type === 'sync';

    // Sync kategorisi → sporcuları pair listesine dönüştür
    // Pair olan sporcular pair olarak, çiftsiz sporcular bireysel görünür
    const filteredAthletes = (() => {
        const baseList = allAthletes.filter(a => {
            if (selectedCatId && a.catId !== selectedCatId) return false;
            if (!selectedCatId) return false;
            return true;
        });

        if (!isSyncCategory) {
            // Bireysel: normal filtre + arama
            return baseList.filter(a => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return getAthleteName(a).toLowerCase().includes(q) ||
                    getAthleteClub(a).toLowerCase().includes(q);
            });
        }

        // Sync kategori: pair olanları tekli göster, çiftsizleri de ekle
        const seenPairs = new Set();
        const result = [];
        baseList.forEach(a => {
            if (a.pairId && allPairs[a.pairId]) {
                if (!seenPairs.has(a.pairId)) {
                    seenPairs.add(a.pairId);
                    const pair = allPairs[a.pairId];
                    // Pair nesnesini CJP sporcu formatına çevir
                    result.push({
                        ...a,
                        uniqueId: pair.id,
                        isPair: true,
                        pairId: pair.id,
                        pairName: pair.displayName,
                        name: pair.displayName,
                        surname: '',
                        club: pair.club || a.club || '',
                    });
                }
            } else {
                // Çiftsiz sporcu — bireysel göster
                result.push(a);
            }
        });

        if (!searchQuery) return result;
        const q = searchQuery.toLowerCase();
        return result.filter(a =>
            getAthleteName(a).toLowerCase().includes(q) ||
            getAthleteClub(a).toLowerCase().includes(q)
        );
    })();

    const catList = Object.values(allCategories);
    const athRes = selected ? (competitionResults[selected.uniqueId] || {}) : {};

    // ── Şifre kapısı ──────────────────────────────────────────────────────
    if (!unlocked && !noPassword) {
        return (
            <PasswordGate
                compId={compId}
                panel={currentPanel}
                role="cjp"
                onUnlock={() => { saveJudgeSession(compId, currentPanel, 'cjp'); setUnlocked(true); }}
                label="BAŞHAKEM (CJP) PANELİ"
            />
        );
    }

    return (
        <div className="admin-split" style={{ height: '100vh' }}>
            {/* ── SOL SIDEBAR ───────────────────────────────────────────── */}
            <div className="sidebar-cockpit">
                <div className="sidebar-header">
                    <select
                        value={selectedCatId}
                        onChange={e => setSelectedCatId(e.target.value)}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 10px', borderRadius: 8, fontWeight: 700 }}
                    >
                        <option value="">Kategori Seçiniz</option>
                        {catList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button
                        onClick={() => dsRef.current && loadRoutineData(activeRoutine)}
                        style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '6px 10px', borderRadius: 8, cursor: 'pointer' }}
                    >
                        <i className="material-icons-round" style={{ fontSize: 18 }}>refresh</i>
                    </button>
                </div>

                <div style={{ padding: '10px 15px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Sporcu Ara..."
                        style={{
                            width: '100%', padding: '10px 14px', borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '0.9rem',
                            boxSizing: 'border-box',
                        }}
                    />
                </div>

                <div className="sidebar-list">
                    {!selectedCatId && (
                        <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                            Sporcu listesi için kategori seçiniz.
                        </div>
                    )}
                    {selectedCatId && filteredAthletes.length === 0 && (
                        <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Sporcu Bulunamadı.</div>
                    )}
                    {filteredAthletes.map((ath, idx) => {
                        const athR = competitionResults[ath.uniqueId] || {};
                        const r1Done = !!athR.r1;
                        const r2Done = !!athR.r2;
                        const isOnField = liveActiveAthId === ath.uniqueId;
                        const isSelected = selected?.uniqueId === ath.uniqueId;

                        let statusColor = '#64748b';
                        let statusText = 'BEKLİYOR';
                        if (r1Done && r2Done) { statusColor = '#22c55e'; statusText = 'TAMAMLANDI'; }
                        else if (r1Done || r2Done) { statusColor = '#eab308'; statusText = r1Done ? '1.SERİ✓' : '2.SERİ✓'; }
                        if (isOnField) { statusColor = '#38bdf8'; statusText = 'TRAMPOLİNDE'; }

                        return (
                            <div
                                key={ath.uniqueId}
                                onClick={() => selectAthlete(ath)}
                                style={{
                                    padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                                    marginBottom: 4, transition: 'all 0.15s',
                                    background: isSelected ? 'rgba(56,189,248,0.12)' : isOnField ? 'rgba(16,185,129,0.08)' : 'transparent',
                                    border: `1px solid ${isSelected ? 'rgba(56,189,248,0.3)' : isOnField ? 'rgba(16,185,129,0.3)' : 'transparent'}`,
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'white' }}>
                                            {idx + 1}. {getAthleteName(ath)}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                                            {getAthleteClub(ath) || '—'}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                        background: `${statusColor}20`, color: statusColor, border: `1px solid ${statusColor}40`,
                                        whiteSpace: 'nowrap',
                                    }}>{statusText}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── SAĞ HUD ──────────────────────────────────────────────── */}
            <div className="hud-container">
                {/* Sporcu Başlığı */}
                <div style={{
                    background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 20, padding: 20, marginBottom: 20,
                }}>
                    <div className="flex-between">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                            <span style={{
                                background: 'linear-gradient(135deg, #f59e0b, #b45309)',
                                padding: '6px 14px', borderRadius: 50, fontSize: '0.85rem', fontWeight: 700, color: 'white',
                            }}>BAŞHAKEM</span>
                            <div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'white' }}>
                                    {selected ? getAthleteName(selected) : '—'}
                                </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>{selected ? getAthleteClub(selected) || '—' : '—'}</span>
                                    {selected && <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600 }}>{selected.catName}</span>}
                                </div>
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            {/* Rutin Sekmeleri */}
                            <div style={{ display: 'flex', gap: 6, background: 'rgba(0,0,0,0.3)', padding: 4, borderRadius: 10, marginBottom: 6 }}>
                                {[1, 2].map(r => (
                                    <button
                                        key={r}
                                        onClick={() => setActiveRoutine(r)}
                                        style={{
                                            border: 'none', padding: '6px 14px', borderRadius: 8,
                                            fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                            background: activeRoutine === r
                                                ? (r === 1 ? '#fbbf24' : '#38bdf8')
                                                : 'transparent',
                                            color: activeRoutine === r ? '#000' : athRes[`r${r}`] ? '#10b981' : 'rgba(255,255,255,0.4)',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        {r}. SERİ {athRes[`r${r}`] ? '✓' : ''}
                                    </button>
                                ))}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 3 }}>SIRADAKİ</div>
                            <div style={{ fontWeight: 600, color: '#94a3b8' }}>{nextAth ? getAthleteName(nextAth) : 'Liste Sonu'}</div>
                        </div>
                    </div>
                </div>

                {/* Kilit Katmanı */}
                <div style={{ position: 'relative' }}>
                    {isLocked && (
                        <div
                            onClick={() => setShowUnlockPopup(true)}
                            style={{
                                position: 'absolute', inset: 0, zIndex: 10, borderRadius: 20,
                                backdropFilter: 'blur(8px)', background: 'rgba(15,23,42,0.7)',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer',
                            }}
                        >
                            <i className="material-icons-round" style={{ fontSize: 40, color: 'white', marginBottom: 10 }}>lock</i>
                            <span style={{ fontSize: '1.3rem', fontWeight: 800, color: 'white' }}>PUANLAR KİLİTLENDİ</span>
                            <span style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: 6 }}>Düzenlemek için tıklayın</span>
                        </div>
                    )}

                    {/* HUD Satır 1: E, D, T, H */}
                    <div className="hud-row" style={{ marginBottom: 16 }}>
                        <HudCard label="E SCORE" accent="#10b981">
                            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'white' }}>{eScore.toFixed(2)}</div>
                            {/* Hareket sayısı */}
                            <div
                                onClick={e => { e.stopPropagation(); setShowElementPopup(true); }}
                                style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(16,185,129,0.2)', border: '1px solid #10b981', borderRadius: 8, padding: '3px 8px', cursor: 'pointer', fontSize: '0.75rem', color: '#10b981', fontWeight: 700 }}
                            >
                                HAREKET <strong style={{ color: 'white' }}>{elementCount}</strong>
                            </div>
                            {/* Hakem noktaları — submitted:true = yeşil, veri var = sarı, yok = gri */}
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                                {['e1','e2','e3','e4','e5','e6'].map(jId => {
                                    const j = judgesData[jId];
                                    const submitted = j?.submitted === true;
                                    const hasData   = j && (j.deductions || j.scores);
                                    const color = submitted ? '#10b981' : hasData ? '#eab308' : 'rgba(255,255,255,0.1)';
                                    return (
                                        <div key={jId} title={jId.toUpperCase()} style={{
                                            width: 10, height: 10, borderRadius: '50%',
                                            background: color,
                                            boxShadow: submitted ? '0 0 8px #10b981' : hasData ? '0 0 8px #eab308' : 'none',
                                        }} />
                                    );
                                })}
                            </div>
                            {/* Tüm hakemler gönderdi bildirimi */}
                            {['e1','e2','e3','e4','e5','e6'].every(jId => judgesData[jId]?.submitted) && (
                                <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#10b981', fontWeight: 700, letterSpacing: 1 }}>
                                    ✓ TÜM HAKEMLER GÖNDERDİ
                                </div>
                            )}
                        </HudCard>

                        <HudCard label="DIFFICULTY (D)" accent="#f59e0b">
                            {dFromJudge !== null ? (
                                // D hakeminden gelen değer — büyük göster
                                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#f59e0b' }}>
                                    {dFromJudge.toFixed(1)}
                                </div>
                            ) : (
                                // D hakemi yok — manuel giriş
                                <input
                                    className="hud-input"
                                    type="number"
                                    step="0.1"
                                    value={dInput}
                                    onChange={e => { setDInput(e.target.value); saveDraft(); }}
                                    placeholder="0.0"
                                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(245,158,11,0.3)', color: 'white' }}
                                />
                            )}
                        </HudCard>

                        {/* T kartı: Bireysel'de aktif, Sync'te devre dışı */}
                        <HudCard label="TIME (T)" accent="#38bdf8"
                            style={isSync ? { opacity: 0.3, pointerEvents: 'none' } : {}}>
                            <input
                                className="hud-input"
                                type="number"
                                step="0.005"
                                value={isSync ? '' : inpT}
                                disabled={isSync}
                                onChange={e => { if (!isSync) { setInpT(e.target.value); saveDraft(); } }}
                                placeholder="0.000"
                                style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${isSync ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.3)'}`, color: 'white' }}
                            />
                        </HudCard>

                        {/* H kartı: Bireysel'de tek input, Sync'te H1+H2 */}
                        <HudCard label={isSync ? `HORZ. DISP — Ort: ${hEffective.toFixed(2)}` : 'HORZ. DISP (H)'} accent="#a855f7">
                            {isSync ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.7rem', color: '#a855f7', fontWeight: 700, minWidth: 22 }}>H1</span>
                                        <input
                                            className="hud-input"
                                            type="number" step="0.1" max="10"
                                            value={inpH}
                                            onChange={e => { setInpH(e.target.value); saveDraft(); }}
                                            placeholder="0.0"
                                            style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(168,85,247,0.4)', color: 'white', flex: 1, fontSize: '1.1rem', padding: '6px 10px' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.7rem', color: '#a855f7', fontWeight: 700, minWidth: 22 }}>H2</span>
                                        <input
                                            className="hud-input"
                                            type="number" step="0.1" max="10"
                                            value={inpH2}
                                            onChange={e => { setInpH2(e.target.value); saveDraft(); }}
                                            placeholder="0.0"
                                            style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(168,85,247,0.4)', color: 'white', flex: 1, fontSize: '1.1rem', padding: '6px 10px' }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <input
                                    className="hud-input"
                                    type="number" step="0.1" max="10"
                                    value={inpH}
                                    onChange={e => { setInpH(e.target.value); saveDraft(); }}
                                    placeholder="9.0"
                                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: 'white' }}
                                />
                            )}
                        </HudCard>
                    </div>

                    {/* HUD Satır 2: S (sync), P, DP */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15, marginBottom: 16 }}>
                        {/* S kartı: Sync'te aktif (T'nin yerine) ve ×2 göstergeli, bireysel'de devre dışı */}
                        <HudCard label={isSync ? 'SYNCHRO (S) ✓  ×2' : 'SYNCHRO (S)'} accent="#c084fc"
                            style={!isSync ? { opacity: 0.3, pointerEvents: 'none' } : {}}>
                            <input
                                className="hud-input"
                                type="number"
                                step="0.01"
                                value={isSync ? inpS : ''}
                                disabled={!isSync}
                                onChange={e => { if (isSync) { setInpS(e.target.value); saveDraft(); } }}
                                placeholder="0.00"
                                style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${isSync ? 'rgba(192,132,252,0.6)' : 'rgba(192,132,252,0.2)'}`, color: 'white' }}
                            />
                            {isSync && sVal > 0 && (
                                <div style={{ fontSize: '0.72rem', color: '#c084fc', fontWeight: 700, marginTop: 4, letterSpacing: 1 }}>
                                    {sVal.toFixed(2)} × 2 = <span style={{ color: 'white' }}>{sEffective.toFixed(2)}</span>
                                </div>
                            )}
                        </HudCard>

                        <HudCard label="PENALTY (P)" accent="#f43f5e">
                            <input
                                className="hud-input"
                                type="number"
                                step="0.1"
                                value={inpP}
                                onChange={e => { setInpP(e.target.value); saveDraft(); }}
                                placeholder="0.0"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e' }}
                            />
                        </HudCard>

                        <HudCard label="ZORLUK KESİNTİSİ (DP)" accent="#fca5a5">
                            <input
                                className="hud-input"
                                type="number"
                                step="0.1"
                                value={inpDp}
                                onChange={e => { setInpDp(e.target.value); saveDraft(); }}
                                placeholder="0.0"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
                            />
                        </HudCard>
                    </div>

                    {/* DNS / DNF */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                        <StatusBtn label="DNS" active={currentStatus === 'DNS'} color="#94a3b8" onClick={() => setCurrentStatus(s => s === 'DNS' ? null : 'DNS')} />
                        <StatusBtn label="DNF" active={currentStatus === 'DNF'} color="#fca5a5" onClick={() => setCurrentStatus(s => s === 'DNF' ? null : 'DNF')} />
                    </div>
                </div>

                {/* Kontrol Paneli */}
                <div className="hud-controls-panel">
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button
                            className="mega-btn"
                            disabled={!selected}
                            onClick={callToField}
                        >
                            <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 6 }}>campaign</i>
                            {activeRoutine}. SERİ BAŞLAT
                        </button>
                        <button
                            onClick={resetScores}
                            disabled={isLocked}
                            style={{ padding: '18px 20px', borderRadius: 12, fontWeight: 700, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: isLocked ? '#475569' : '#fca5a5', cursor: isLocked ? 'not-allowed' : 'pointer', opacity: isLocked ? 0.4 : 1 }}
                        >
                            SIFIRLA
                        </button>
                    </div>

                    <div className="hud-total-group">
                        <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 700, letterSpacing: 2, display: 'block', textTransform: 'uppercase' }}>Toplam Skor</span>
                        <span className="hud-total-val">{currentStatus || totalScore.toFixed(3)}</span>
                    </div>

                    <button
                        className="hud-btn-publish"
                        disabled={!selected || isSubmitting || isLocked}
                        onClick={publishScore}
                        style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 0 20px rgba(16,185,129,0.4)' }}
                    >
                        <i className="material-icons-round" style={{ fontSize: 24 }}>publish</i>
                        <span>{isSubmitting ? 'YAYINLANIYOR...' : 'YAYINLA'}</span>
                    </button>
                </div>
            </div>

            {/* Kilit Aç Popup */}
            {showUnlockPopup && (
                <ModalOverlay onClose={() => setShowUnlockPopup(false)}>
                    <div style={{ fontWeight: 700, color: 'white', marginBottom: 20, textAlign: 'center', fontSize: '1rem' }}>
                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8, color: '#fbbf24' }}>lock_open</i>
                        Hakem Kilidini Aç
                    </div>
                    <button onClick={() => { setIsLocked(false); setShowUnlockPopup(false); }}
                        style={unlockBtnStyle('#fbbf24')}>
                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 5 }}>star</i>
                        TÜM KİLİTLERİ AÇ
                    </button>
                    <button onClick={() => setShowUnlockPopup(false)} style={{ ...unlockBtnStyle('#ef4444'), marginTop: 12 }}>
                        <i className="material-icons-round" style={{ verticalAlign: 'middle', fontSize: 18, marginRight: 5 }}>close</i>
                        Kapat
                    </button>
                </ModalOverlay>
            )}

            {/* Hareket Sayısı Popup */}
            {showElementPopup && (
                <ModalOverlay onClose={() => setShowElementPopup(false)}>
                    <div style={{ fontWeight: 700, color: 'white', marginBottom: 20, textAlign: 'center', fontSize: '1rem' }}>
                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8, color: '#10b981' }}>format_list_numbered</i>
                        Değerlendirilecek Hareket Sayısı
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                        {[1,2,3,4,5,6,7,8,9,10].map(n => (
                            <button
                                key={n}
                                onClick={() => { setElementCount(n); setShowElementPopup(false); }}
                                style={{
                                    padding: '14px 8px', borderRadius: 10, fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer',
                                    border: elementCount === n ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                                    background: elementCount === n ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)',
                                    color: elementCount === n ? '#10b981' : '#94a3b8',
                                }}
                            >{n}</button>
                        ))}
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 12, fontSize: '0.82rem', color: '#64748b' }}>
                        E Başlangıç Puanı: <strong style={{ color: '#10b981' }}>{elementCount * 2}</strong>
                    </div>
                    <button onClick={() => setShowElementPopup(false)} style={{ ...unlockBtnStyle('#ef4444'), marginTop: 14 }}>Kapat</button>
                </ModalOverlay>
            )}
        </div>
    );
}

// ── Yardımcı Bileşenler ───────────────────────────────────────────────────
function HudCard({ label, accent, children, onClick, disabled }) {
    return (
        <div
            className="hud-card"
            onClick={onClick}
            style={{ cursor: onClick ? 'pointer' : 'default', opacity: disabled ? 0.5 : 1, position: 'relative' }}
        >
            <div className="hud-label" style={{ color: accent }}>{label}</div>
            {children}
        </div>
    );
}

function StatusBtn({ label, active, color, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                flex: 1, padding: 12, borderRadius: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? color : color + '40'}`,
                background: active ? `${color}30` : `${color}10`,
                color: active ? color : color + '99',
                transition: 'all 0.2s',
            }}
        >{label}</button>
    );
}

function ModalOverlay({ children, onClose }) {
    return (
        <div
            onClick={e => e.target === e.currentTarget && onClose()}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(5px)',
            }}
        >
            <div style={{
                background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16, padding: 28, maxWidth: 380, width: '90%',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}>
                {children}
            </div>
        </div>
    );
}

function unlockBtnStyle(color) {
    return {
        width: '100%', padding: 12, borderRadius: 10, fontWeight: 700, cursor: 'pointer',
        border: `1px solid ${color}40`, background: `${color}15`, color,
        fontSize: '0.95rem', display: 'block', marginBottom: 8,
    };
}
