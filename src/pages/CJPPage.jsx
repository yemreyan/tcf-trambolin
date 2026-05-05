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
import { ref, onValue, get, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { DataService } from '../lib/DataService';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import PasswordGate from '../components/PasswordGate';

// ── Sabit: E skor hesaplama ───────────────────────────────────────────────
// 6 hakemden en yüksek ve en düşük atılır, 4 orta değer toplanır
function calcEScore(judgesData, elementCount = 10) {
    const base = elementCount * 2; // Her hareket = 2 puan başlangıç
    const allDeducts = Object.values(judgesData || {})
        .filter(j => j && j.scores)
        .map(j => {
            const total = (j.scores || []).reduce((a, b) => a + Number(b), 0) + Number(j.landing || 0);
            return total;
        });

    if (allDeducts.length === 0) return 0;

    let sum = allDeducts.reduce((a, b) => a + b, 0);
    if (allDeducts.length >= 4) {
        sum -= Math.max(...allDeducts) + Math.min(...allDeducts);
        sum = sum / (allDeducts.length - 2);
    } else {
        sum = sum / allDeducts.length;
    }
    return Math.max(0, base - sum);
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
    const [inpT, setInpT] = useState('');
    const [inpH, setInpH] = useState('');
    const [inpS, setInpS] = useState('');
    const [inpP, setInpP] = useState('');
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

    const dsRef = useRef(null);
    const unsubRefs = useRef([]);

    // ── Hesaplanan değerler ───────────────────────────────────────────────
    const eScore = calcEScore(judgesData, elementCount);
    const dScore = parseFloat(inpD(judgesData)) || 0;

    function inpD(jd) {
        // D skoru, judge-d'nin gönderdiği veriden alınır (ileride)
        // Şimdilik sadece manuel input olarak dönelim
        return 0;
    }

    const tVal   = parseFloat(inpT) || 0;
    const hVal   = parseFloat(inpH) || 0;
    const sVal   = parseFloat(inpS) || 0;
    const pVal   = parseFloat(inpP) || 0;
    const dpVal  = parseFloat(inpDp) || 0;
    const dManual = parseFloat(inpT) || 0; // D hakemin girdiği — ayrı state ile yönetilecek

    // D input için ayrı state
    const [dInput, setDInput] = useState('');
    const dVal = parseFloat(dInput) || 0;

    // Total = D + E + T - H - S - P - DP
    const totalScore = Math.max(0,
        dVal + eScore + tVal - hVal - sVal - pVal - dpVal
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
                    list.push({ ...ath, catId: cat.id, catName: cat.name, catType: cat.type, uniqueId: ath.id });
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

        unsubRefs.current = [compUnsub, resUnsub, judgesUnsub, ctxUnsub];
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
        setInpT(''); setInpH(''); setInpS(''); setInpP(''); setInpDp('');
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
            setInpT(result.t || '');
            setInpH(result.h || '');
            setInpS(result.s || '');
            setInpP(result.p || '');
            setInpDp(result.dp || '');
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
            inputs: { t: inpT, h: inpH, s: inpS, p: inpP, dp: inpDp, d: dInput },
            elementCount,
        });
    }

    // ── Sahaya Çağır ──────────────────────────────────────────────────────
    async function callToField() {
        if (!selected || !dsRef.current) return;
        setIsLocked(false);

        await dsRef.current.updateActiveContext(currentPanel, {
            current: selected,
            next: nextAth,
            routine: activeRoutine,
            categoryId: selected.catId,
            timestamp: Date.now(),
        });

        // Hakem ekranlarını temizle
        await remove(ref(db, `live/${compId}/panels/${currentPanel}/scores/judges`));
        setJudgesData({});

        toast(`${selected.name} ${selected.surname} sahaya çağrıldı — ${activeRoutine}. Seri`, 'success');
    }

    // ── Yayınla ───────────────────────────────────────────────────────────
    async function publishScore() {
        if (!selected || !dsRef.current) return;

        if (currentStatus === 'DNS' || currentStatus === 'DNF') {
            const ok = await confirm('Durum Yayınla', `${selected.name} ${selected.surname} — ${currentStatus} olarak yayınlanacak. Onaylıyor musunuz?`);
            if (!ok) return;

            setIsSubmitting(true);
            try {
                await dsRef.current.publishResult(selected.uniqueId, activeRoutine, {
                    d: 0, e: 0, t: 0, h: 0, s: 0, p: 0, total: 0,
                    status: currentStatus,
                    judges: {},
                });
                toast(`${currentStatus} yayınlandı.`, 'info');
                setIsLocked(true);
            } catch (e) {
                toast('Yayınlama hatası: ' + e.message, 'error');
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        const ok = await confirm('Puanı Yayınla',
            `${selected.name} ${selected.surname} — ${activeRoutine}. Seri\nToplam: ${totalScore.toFixed(3)}\n\nYayınlamak istediğinize emin misiniz?`
        );
        if (!ok) return;

        setIsSubmitting(true);
        try {
            await dsRef.current.publishResult(selected.uniqueId, activeRoutine, {
                d: dVal,
                e: parseFloat(eScore.toFixed(2)),
                t: parseFloat(inpT) || 0,
                h: parseFloat(inpH) || 0,
                s: parseFloat(inpS) || 0,
                p: parseFloat(inpP) || 0,
                dp: parseFloat(inpDp) || 0,
                total: parseFloat(totalScore.toFixed(3)),
                status: 'published',
                judges: judgesData,
                elementCount,
            });
            toast('Puan yayınlandı!', 'success');
            setIsLocked(true);
        } catch (e) {
            toast('Yayınlama hatası: ' + e.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    }

    // ── Sıfırla ───────────────────────────────────────────────────────────
    function resetScores() {
        setInpT(''); setInpH(''); setInpS(''); setInpP(''); setInpDp('');
        setDInput('');
        setJudgesData({});
        setCurrentStatus(null);
        setIsLocked(false);
    }

    // ── Filtre ────────────────────────────────────────────────────────────
    const filteredAthletes = allAthletes.filter(a => {
        if (selectedCatId && a.catId !== selectedCatId) return false;
        if (!selectedCatId) return false; // Kategori seçilmeden gösterme
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (a.name + ' ' + a.surname).toLowerCase().includes(q) ||
            (a.club || '').toLowerCase().includes(q);
    });

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
                                            {idx + 1}. {ath.name} {ath.surname}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                                            {ath.club || '—'}
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
                                    {selected ? `${selected.name} ${selected.surname}` : '—'}
                                </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>{selected?.club || '—'}</span>
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
                            <div style={{ fontWeight: 600, color: '#94a3b8' }}>{nextAth ? `${nextAth.name} ${nextAth.surname}` : 'Liste Sonu'}</div>
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
                        <HudCard label="E SCORE" accent="#10b981" onClick={() => setShowUnlockPopup(true)}>
                            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'white' }}>{eScore.toFixed(2)}</div>
                            {/* Hareket sayısı */}
                            <div
                                onClick={e => { e.stopPropagation(); setShowElementPopup(true); }}
                                style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(16,185,129,0.2)', border: '1px solid #10b981', borderRadius: 8, padding: '3px 8px', cursor: 'pointer', fontSize: '0.75rem', color: '#10b981', fontWeight: 700 }}
                            >
                                HAREKET <strong style={{ color: 'white' }}>{elementCount}</strong>
                            </div>
                            {/* Hakem noktaları */}
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                                {['e1','e2','e3','e4','e5','e6'].map(jId => {
                                    const j = judgesData[jId];
                                    const hasData = j && j.scores;
                                    return (
                                        <div key={jId} style={{
                                            width: 10, height: 10, borderRadius: '50%',
                                            background: hasData ? '#10b981' : 'rgba(255,255,255,0.1)',
                                            boxShadow: hasData ? '0 0 8px #10b981' : 'none',
                                        }} />
                                    );
                                })}
                            </div>
                        </HudCard>

                        <HudCard label="DIFFICULTY (D)" accent="#f59e0b" onClick={() => setShowUnlockPopup(true)}>
                            <input
                                className="hud-input"
                                type="number"
                                step="0.1"
                                value={dInput}
                                onChange={e => { setDInput(e.target.value); saveDraft(); }}
                                placeholder="0.0"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(245,158,11,0.3)', color: 'white' }}
                            />
                        </HudCard>

                        <HudCard label="TIME (T)" accent="#38bdf8">
                            <input
                                className="hud-input"
                                type="number"
                                step="0.005"
                                value={inpT}
                                onChange={e => { setInpT(e.target.value); saveDraft(); }}
                                placeholder="0.000"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(59,130,246,0.3)', color: 'white' }}
                            />
                        </HudCard>

                        <HudCard label="HORZ. DISP (H)" accent="#a855f7">
                            <input
                                className="hud-input"
                                type="number"
                                step="0.1"
                                max="10"
                                value={inpH}
                                onChange={e => { setInpH(e.target.value); saveDraft(); }}
                                placeholder="9.0"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: 'white' }}
                            />
                        </HudCard>
                    </div>

                    {/* HUD Satır 2: S, P, DP */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15, marginBottom: 16 }}>
                        <HudCard label="SYNCHRO (S)" accent="#c084fc">
                            <input
                                className="hud-input"
                                type="number"
                                step="0.01"
                                value={inpS}
                                onChange={e => { setInpS(e.target.value); saveDraft(); }}
                                placeholder="0.00"
                                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(192,132,252,0.3)', color: 'white' }}
                            />
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
                            style={{ padding: '18px 20px', borderRadius: 12, fontWeight: 700, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer' }}
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
                        disabled={!selected || isSubmitting}
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
