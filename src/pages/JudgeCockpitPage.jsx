/**
 * JudgeCockpitPage.jsx
 * Mevcut judge_cockpit.html + judge_cockpit.js — E/D Hakem kesinti girişi
 *
 * Düzeltmeler:
 * - E hakemi: Firebase'e `deductions` alanı olarak yazıyor (HTML CJP ile uyumlu)
 * - D hakemi: tek sayı girişi (val alanı) + key olarak 'd' kullanıyor
 * - judgeKey URL'den türetiliyor: e1..e6 veya d
 * - Aktif sporcu panel-specific activeContext'ten dinleniyor
 * - Submit butonu gerçekten submitted:true flag'i gönderiyor
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { getAthleteName, getAthleteClub } from '../lib/DataService';
import PasswordGate from '../components/PasswordGate';
import { useRules } from '../lib/Rules';

// Kesinti/iniş seçenekleri ve hareket sayısı yarışma kurallarından gelir
// (Kurallar ekranı). Tuş takımı bu seçeneklerin birleşiminden üretilir;
// seçili kutuda geçerli olmayan tuş pasifleşir.

export default function JudgeCockpitPage() {
    const [params] = useSearchParams();
    const { checkJudgeAccess, saveJudgeSession, isJudgeSessionValid, startInactivityTimer, clearJudgeSession } = useAuth();

    const compId  = params.get('comp')  || localStorage.getItem('tra_active_comp');
    const role    = params.get('role')  || 'judge-e';
    const judgeN  = params.get('id')    || '1';
    const panel   = params.get('panel') || 'A';

    const rules = useRules(compId);
    const DEDUCT_OPTIONS  = rules.judgeInput.deductOptions;
    const LANDING_OPTIONS = rules.judgeInput.landingOptions;
    const JUMP_COUNT      = rules.judgeInput.maxElements;
    // Tuş takımı: iki seçenek kümesinin birleşimi, onda birlik tam sayı olarak
    const KEYPAD = [...new Set([...DEDUCT_OPTIONS, ...LANDING_OPTIONS])]
        .sort((a, b) => a - b)
        .map(v => Math.round(v * 10));

    const isD = role === 'judge-d';

    // Hakem anahtarı: E hakemleri e1..e6, D hakemi 'd' (HTML CJP ile uyumlu)
    const judgeKey  = isD ? 'd' : `e${judgeN}`;
    const roleLabel = isD ? 'D (ZORLUK)' : `E${judgeN}`;

    const [unlocked, setUnlocked]   = useState(false);
    const [noPassword, setNoPassword] = useState(false);

    // E hakem state
    const [deductions, setDeductions] = useState(Array(JUMP_COUNT).fill(0));
    const [landing, setLanding]     = useState(0);
    const [focused, setFocused]     = useState(0);

    // Hangi kutulara gerçekten değer girildi? Dizi 0'larla dolu başladığı için
    // "0 kesinti verdim" ile "buraya hiç dokunmadım" ayırt edilemiyordu.
    // Geri silme tuşu bu ayrımı gerektiriyor.
    const [entered, setEntered]     = useState(Array(JUMP_COUNT).fill(false));
    const [landingEntered, setLandingEntered] = useState(false);

    // Kaç eleman puanlanacak — CJP'den activeContext üzerinden gelir.
    // null = CJP henüz sporcuyu sahaya çağırmadı / değeri yazmadı.
    const [elementCount, setElementCount] = useState(null);
    const [routine, setRoutine] = useState(null);

    // Girdilerin anlık doğrusu. State'e render için, ref'e senkron yazılır:
    // iki kutuya arka arkaya hızlı basıldığında React henüz yeniden render
    // etmediği için handler closure'daki eski diziyi görüyor ve ikinci
    // dokunuş birincinin değerini siliyordu.
    const deductionsRef = useRef(Array(JUMP_COUNT).fill(0));
    const landingRef    = useRef(0);
    const enteredRef    = useRef(Array(JUMP_COUNT).fill(false));
    const landingEnteredRef = useRef(false);

    // D hakem state — tek zorluk değeri
    const [dVal, setDVal]           = useState('');

    const [athlete, setAthlete]     = useState(null);
    const [submitted, setSubmitted] = useState(false);
    const [connected, setConnected] = useState(false);
    // Hakemin kendi adı — jüri panelinden okunur (Jüri ekranında girilir)
    const [judgeName, setJudgeName] = useState('');

    const unsubRef = useRef(null);
    const ownUnsubRef = useRef(null);
    // Son "sahaya çağırma" jetonu — aynı sporcu tekrar çağrıldığında da
    // sıfırlama yapılabilmesi için sporcu kimliği + zaman damgası tutulur.
    const lastCallRef = useRef(null);

    // Bu çağrı için başlangıç durumu alındı mı? Kendi düğümünü dinleyen
    // listener her yazımda tetiklendiği için geri yükleme TEK SEFERLİK olmalı;
    // aksi halde hakem giriş yaparken uzaktan gelen eski değer üzerine biner.
    const hydratedRef = useRef(false);

    // Girdi alanlarını sıfırla (yeni çağrı veya CJP iptali sonrası)
    const resetEntry = useCallback(() => {
        deductionsRef.current = Array(JUMP_COUNT).fill(0);
        landingRef.current = 0;
        enteredRef.current = Array(JUMP_COUNT).fill(false);
        landingEnteredRef.current = false;
        setDeductions(Array(JUMP_COUNT).fill(0));
        setLanding(0);
        setFocused(0);
        setDVal('');
        setSubmitted(false);
        setEntered(Array(JUMP_COUNT).fill(false));
        setLandingEntered(false);
    }, [JUMP_COUNT]);

    // Firebase'deki kendi kaydından durumu geri yükle (sayfa yenilenmesi,
    // tabletin uyuması, sekmenin kapanıp açılması).
    const hydrateFrom = useCallback((data) => {
        if (!data) return;
        // `scores` eski alan adı — geriye dönük uyumluluk
        const stored = data.deductions || data.scores;
        if (Array.isArray(stored)) {
            const arr = Array(JUMP_COUNT).fill(0);
            const ent = Array(JUMP_COUNT).fill(false);
            stored.slice(0, JUMP_COUNT).forEach((v, i) => { arr[i] = Number(v) || 0; });
            // Hangi kutunun gerçekten doldurulduğu kayıttan okunur. Bu alan
            // olmayan eski kayıtlarda (geriye dönük) hepsi dolu sayılır.
            if (Array.isArray(data.entered)) {
                data.entered.slice(0, JUMP_COUNT).forEach((e, i) => { ent[i] = e === true; });
            } else {
                stored.slice(0, JUMP_COUNT).forEach((_, i) => { ent[i] = true; });
            }
            deductionsRef.current = arr;
            enteredRef.current = ent;
            setDeductions(arr);
            setEntered(ent);
        }
        if (data.landing != null) {
            landingRef.current = Number(data.landing) || 0;
            landingEnteredRef.current = data.landingEntered != null ? data.landingEntered === true : true;
            setLanding(landingRef.current);
            setLandingEntered(landingEnteredRef.current);
        }
        if (data.val != null) setDVal(String(data.val));
        // Gönderilmiş bir not yenilendiğinde yine gönderilmiş görünmeli
        setSubmitted(data.submitted === true);
    }, [JUMP_COUNT]);

    // maxElements kuraldan geldiği için değişebilir; diziler buna göre
    // yeniden boyutlanmazsa fazladan kutular boşta kalır ve girilemez.
    useEffect(() => {
        const fit = (arr, fill) => {
            const next = Array(JUMP_COUNT).fill(fill);
            (arr || []).slice(0, JUMP_COUNT).forEach((v, i) => { next[i] = v; });
            return next;
        };
        deductionsRef.current = fit(deductionsRef.current, 0);
        enteredRef.current    = fit(enteredRef.current, false);
        setDeductions(d => fit(d, 0));
        setEntered(e => fit(e, false));
    }, [JUMP_COUNT]);

    // ── Hakemin adı ───────────────────────────────────────────────────────
    // URL'deki panel parametresi jüri paneli id'si ile aynı (JuryPage linkleri
    // böyle üretiyor), isim oradaki members listesinden okunur.
    useEffect(() => {
        if (!compId || !panel) return;
        const unsub = onValue(
            ref(db, `competitions/${compId}/juryPanels/${panel}/members`),
            snap => {
                const m = snap.val() || {};
                // Tek D hakemi var; jüri listesinde anahtarı 'd1', ekranda 'd'.
                // Eski kayıtlarda 'd' de bulunabildiği için ikisi de denenir.
                const raw = isD ? (m.d1 ?? m.d) : m[judgeKey];
                setJudgeName(typeof raw === 'string' ? raw.trim() : (raw?.name || ''));
            }
        );
        return () => unsub();
    }, [compId, panel, judgeKey, isD, judgeN]);

    // ── Şifre Kapısı ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;
        (async () => {
            if (isJudgeSessionValid(compId, panel, role)) { setUnlocked(true); return; }
            const result = await checkJudgeAccess(compId, panel, role);
            if (result === 'no_password') { setNoPassword(true); setUnlocked(true); }
        })();
    }, [compId, panel, role]);

    // ── Aktif Sporcu — panel-specific activeContext ───────────────────────
    useEffect(() => {
        if (!unlocked || !compId) return;
        setConnected(true);

        unsubRef.current = onValue(
            ref(db, `live/${compId}/panels/${panel}/activeContext`),
            snap => {
                const ctx = snap.val();
                const currentAth = ctx?.current || null;
                if (!currentAth) return;

                // Sıfırlama yalnızca sporcu kimliğine bakılarak yapılırsa, CJP
                // aynı sporcuyu tekrar sahaya çağırdığında ekran açılmıyordu.
                // CJP her çağrıda hakem verilerini sildiği için jeton zaman
                // damgasını da içerir.
                const callToken = [
                    currentAth.uniqueId || currentAth.id,
                    ctx?.timestamp ?? '',
                    ctx?.routine ?? '',
                ].join('#');

                if (lastCallRef.current === null) {
                    // İlk yükleme — sıfırlama YOK. Ekran yenilenmiş olabilir,
                    // durum aşağıdaki kendi düğümü dinleyicisinden gelir.
                    lastCallRef.current = callToken;
                } else if (lastCallRef.current !== callToken) {
                    // Gerçek yeni çağrı — CJP hakem verilerini de sildi
                    lastCallRef.current = callToken;
                    hydratedRef.current = true; // artık yerel giriş esas
                    resetEntry();
                    if (navigator.vibrate) navigator.vibrate(200);
                }
                // Kaç eleman puanlanacak — CJP sporcu sahadayken de değiştirebilir
                const ec = Number(ctx?.elementCount);
                setElementCount(Number.isFinite(ec) && ec >= 1 && ec <= JUMP_COUNT ? ec : null);
                setRoutine(ctx?.routine ?? null);
                setAthlete(currentAth);
            }
        );

        // Kendi düğümünü dinle:
        // - Düğüm yoksa (CJP notu iptal etti veya yeni çağrı) kilit açılır,
        //   girdiler sıfırlanır. Diğer hakemlerin notlarına dokunulmaz.
        // - Düğüm varsa ve bu ekran henüz durumunu almadıysa geri yüklenir
        //   (sayfa yenilendiğinde değerler kaybolmasın).
        ownUnsubRef.current = onValue(
            ref(db, `live/${compId}/panels/${panel}/scores/judges/${judgeKey}`),
            snap => {
                if (!snap.exists()) {
                    hydratedRef.current = true;
                    resetEntry();
                    return;
                }
                if (!hydratedRef.current) {
                    hydratedRef.current = true;
                    hydrateFrom(snap.val());
                }
                // Zaten yüklendiyse yoksay — yerel giriş esastır
            }
        );

        return () => {
            // Abonelik kapanıyorsa gösterge de sönsün; eskiden kopuk ekranda
            // nokta yeşil kalıyor, hakem bağlı sanıyordu.
            setConnected(false);
            if (unsubRef.current) unsubRef.current();
            if (ownUnsubRef.current) ownUnsubRef.current();
        };
    }, [unlocked, compId, panel, judgeKey, resetEntry, hydrateFrom]);

    // ── İnaktivite ────────────────────────────────────────────────────────
    // Şifre tanımlı değilse kilit ÇALIŞTIRILMAZ. Aksi halde 10 dakika
    // dokunulmayan ekran unlocked=false oluyor; şifre kapısı yalnızca şifre
    // varken gösterildiği için hakem normal ekranı görmeye devam ediyor ama
    // Firebase abonelikleri kapanmış oluyordu — sahaya çağrılan sporcu
    // ekrana hiç düşmüyor, ancak sayfa yenilenince geliyordu.
    useEffect(() => {
        if (!unlocked || noPassword) return;
        startInactivityTimer(() => { clearJudgeSession(); setUnlocked(false); }, rules.session.inactivityMinutes * 60 * 1000);
    }, [unlocked, noPassword, rules.session.inactivityMinutes]);

    // ── Firebase'e yaz ───────────────────────────────────────────────────
    // Doğru path: live/{compId}/panels/{panel}/scores/judges/{judgeKey}
    const writePath = `live/${compId}/panels/${panel}/scores/judges/${judgeKey}`;

    async function syncLive(payload, isSubmit = false) {
        if (!compId) return;
        try {
            await set(ref(db, writePath), {
                judgeId:    judgeKey,
                role:       roleLabel,
                ...payload,
                lastUpdate: Date.now(),
                submitted:  isSubmit,
            });
        } catch (e) {
            console.error('syncLive error:', e);
        }
    }

    // ── E Hakem: Tap sıçrama ──────────────────────────────────────────────
    // Not: değerler ref'ten okunur, state'ten değil — hızlı arka arkaya
    // dokunuşlarda closure'daki eski dizi bir öncekinin değerini siliyordu.
    const writeJump = useCallback((index, val, isEntered) => {
        const next = deductionsRef.current.map((d, i) => i === index ? val : d);
        const nextEntered = enteredRef.current.map((e, i) => i === index ? isEntered : e);
        deductionsRef.current = next;
        enteredRef.current = nextEntered;
        setDeductions(next);
        setEntered(nextEntered);
        syncLive({
            deductions: next, landing: landingRef.current,
            entered: nextEntered, landingEntered: landingEnteredRef.current,
        }, false);
        setSubmitted(false);
    }, [athlete]);

    const tap = useCallback((index, val) => {
        writeJump(index, val, true);
        const last = (elementCount || JUMP_COUNT) - 1;
        setFocused(index < last ? index + 1 : JUMP_COUNT);
    }, [writeJump, elementCount]);

    // Geri silme — kutuyu boşaltır. Firebase'e 0 yazılır (dizi içine null
    // yazılırsa Firebase anahtarı siler ve dizi kayar); boşluk ekranda kalır.
    const clearJump = useCallback((index) => {
        writeJump(index, 0, false);
        setFocused(index);
    }, [writeJump]);

    const writeLanding = useCallback((val, isEntered) => {
        landingRef.current = val;
        landingEnteredRef.current = isEntered;
        setLanding(val);
        setLandingEntered(isEntered);
        syncLive({
            deductions: deductionsRef.current, landing: val,
            entered: enteredRef.current, landingEntered: isEntered,
        }, false);
        setSubmitted(false);
    }, [athlete]);

    const tapLanding   = useCallback((val) => writeLanding(val, true), [writeLanding]);
    const clearLanding = useCallback(() => writeLanding(0, false), [writeLanding]);

    // Kaç kutu gösterilecek — sayı CJP'den gelir, yoksa 10 varsayılır.
    // İniş (L) yalnızca tam seride puanlanır: hareket sayısı 10'un altındaysa
    // seri tamamlanmamış demektir, L kutusu hiç gösterilmez ve toplama girmez.
    const shownJumps  = elementCount || JUMP_COUNT;
    const showLanding = shownJumps >= rules.judgeInput.landingMinElements;

    // ── Ortak tuş takımı ──────────────────────────────────────────────────
    const isLandingFocused = showLanding && focused === JUMP_COUNT;
    const activeOptions = isLandingFocused ? LANDING_OPTIONS : DEDUCT_OPTIONS;

    const pressKey = useCallback((tenths) => {
        const val = tenths / 10;
        if (isLandingFocused) tapLanding(val);
        else tap(focused, val);
    }, [isLandingFocused, tapLanding, tap, focused]);

    const pressBackspace = useCallback(() => {
        if (isLandingFocused) clearLanding();
        else clearJump(focused);
    }, [isLandingFocused, clearLanding, clearJump, focused]);

    const focusedEntered = isLandingFocused ? landingEntered : entered[focused];
    const routineLabel = routine ? ` — ${routine}. Seri` : '';

    // ── D Hakem: Değer değişimi ───────────────────────────────────────────
    function handleDValChange(v) {
        setDVal(v);
        syncLive({ val: parseFloat(v) || 0 }, false);
        setSubmitted(false);
    }

    // ── Submit ────────────────────────────────────────────────────────────
    async function handleSubmit() {
        if (isD) {
            await syncLive({ val: parseFloat(dVal) || 0 }, true);
        } else {
            // ref'ten oku — son dokunuş henüz render edilmemiş olabilir
            await syncLive({
                deductions: deductionsRef.current, landing: landingRef.current,
                entered: enteredRef.current, landingEntered: landingEnteredRef.current,
            }, true);
        }
        setSubmitted(true);
    }

    // ── E hakem toplam ────────────────────────────────────────────────────
    // Yalnızca puanlanan elemanlar sayılır; CJP de calcEScore'da fazlasını
    // yok sayıyor, eskiden hakem gereksiz yere farklı bir toplam görüyordu.
    const eTotal = deductions.slice(0, shownJumps).reduce((a, b) => a + b, 0)
        + (showLanding ? landing : 0);

    // CJP eleman sayısını yazmamışsa (sporcu bu sürümden önce sahaya
    // çağrılmışsa olur) 10 elemanla devam edilir — puanlama kilitlenmez.
    const canSubmit = !!athlete;
    // Izgara HER ZAMAN tam genişlikte kurulur (maxElements + L). Hareket
    // sayısı azalınca kutular kaybolmuyor, yalnızca pasifleşiyor — aksi halde
    // kalan kutular büyüyüp hakemin dokunma hedefleri kayıyordu.
    const slotCount = JUMP_COUNT + 1;
    const activeCount = shownJumps + (showLanding ? 1 : 0);
    const filledCount = entered.slice(0, shownJumps).filter(Boolean).length
        + (showLanding && landingEntered ? 1 : 0);

    // Hareket sayısı azalınca: odak pasifleşen kutuda kalmasın. İniş de
    // kapandıysa daha önce girilmiş iniş değeri temizlenir — aksi halde CJP
    // hesabında ekranda görünmeyen bir kesinti kalırdı. Sıçrama kutularındaki
    // değerler SİLİNMEZ; kutu pasif ama görünür kaldığı için hakem ne girdiğini
    // görebiliyor ve CJP zaten yalnızca ilk N elemanı sayıyor.
    useEffect(() => {
        // Odak pasifleşen bir kutuda kalmasın
        if (focused === JUMP_COUNT ? !showLanding : focused >= shownJumps) {
            setFocused(Math.max(0, shownJumps - 1));
        }
        if (showLanding) return;
        if (landingEnteredRef.current || landingRef.current !== 0) clearLanding();
    }, [showLanding, shownJumps, focused, clearLanding]);

    // ── Unlock ────────────────────────────────────────────────────────────
    function handleUnlock() {
        saveJudgeSession(compId, panel, role);
        setUnlocked(true);
    }

    if (!unlocked && !noPassword) {
        return (
            <PasswordGate
                compId={compId}
                panel={panel}
                role={role}
                onUnlock={handleUnlock}
                label={`${roleLabel} — Hakem Ekranı`}
            />
        );
    }

    // ── D Hakem Arayüzü ───────────────────────────────────────────────────
    // E paneliyle aynı tema: gradyan zemin, iki satırlı başlık, açık tuşlar.
    if (isD) {
        const dNum = parseFloat(dVal || 0).toFixed(1);
        return (
            <div style={{
                height: '100vh', color: '#fff', fontFamily: "'Outfit', sans-serif",
                overflow: 'hidden', background: SCREEN_BG,
                display: 'flex', flexDirection: 'column',
            }}>
                <JudgeHeader
                    connected={connected}
                    roleLabel={roleLabel}
                    judgeName={judgeName}
                    rightText={`${athlete?.catName || '—'}${routineLabel}`}
                    rightValue={dNum}
                    athleteName={athlete ? getAthleteName(athlete) : 'SPORCU BEKLENİYOR…'}
                    club={athlete ? getAthleteClub(athlete) : ''}
                />

                {/* Gönderim perdesi */}
                {submitted && (
                    <div style={{
                        position: 'fixed', inset: 0, zIndex: 200,
                        background: 'rgba(9,6,26,0.94)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 20,
                    }}>
                        <div style={{
                            width: 100, height: 100, borderRadius: '50%',
                            background: 'rgba(16,185,129,0.15)', border: '3px solid #10b981',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 60px rgba(16,185,129,0.4)',
                        }}>
                            <i className="material-icons-round" style={{ fontSize: 52, color: '#10b981' }}>check_circle</i>
                        </div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#10b981', letterSpacing: 2 }}>
                            PUAN GÖNDERİLDİ
                        </div>
                        <div style={{
                            fontFamily: "'Space Mono', monospace",
                            fontSize: '4rem', fontWeight: 700, color: 'white',
                            textShadow: '0 0 40px rgba(16,185,129,0.6)',
                        }}>
                            {dNum}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#cbd5e1', marginTop: 8 }}>
                            {athlete ? getAthleteName(athlete) : '—'}
                        </div>
                        <button onClick={() => setSubmitted(false)} style={correctBtnStyle}>
                            <i className="material-icons-round">edit</i> DÜZELT
                        </button>
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: 12, letterSpacing: 1 }}>
                            Düzeltip tekrar gönderebilirsiniz
                        </div>
                    </div>
                )}

                {/* Gövde — tek ekran, kaydırma yok */}
                <div style={{
                    flex: 1, minHeight: 0, width: '100%',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    gap: 'clamp(12px, 2.5vh, 28px)', padding: 'clamp(12px, 2vw, 28px)',
                    maxWidth: 760, margin: '0 auto', boxSizing: 'border-box',
                }}>
                    {/* Büyük değer göstergesi */}
                    <div style={{
                        background: '#ffffff', borderRadius: 12,
                        padding: 'clamp(14px, 3vh, 32px)', textAlign: 'center',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
                    }}>
                        <div style={{
                            fontFamily: "'Space Mono', monospace",
                            fontSize: 'clamp(2.4rem, 9vw, 5rem)', fontWeight: 700,
                            color: '#0f172a', lineHeight: 1,
                        }}>
                            {dNum}
                        </div>
                        <div style={{
                            fontSize: 'clamp(0.65rem, 1.4vw, 0.85rem)', color: '#64748b',
                            marginTop: 8, letterSpacing: 2, fontWeight: 700,
                        }}>
                            ZORLUK PUANI (D)
                        </div>
                    </div>

                    {/* Serbest giriş */}
                    <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="20"
                        value={dVal}
                        onChange={e => handleDValChange(e.target.value)}
                        placeholder="Değer girin"
                        disabled={submitted}
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.92)',
                            border: 'none', borderRadius: 10,
                            padding: 'clamp(8px, 1.6vh, 14px)', color: '#0f172a',
                            fontFamily: "'Space Mono', monospace",
                            fontSize: 'clamp(1rem, 2.4vw, 1.6rem)', textAlign: 'center',
                            outline: 'none', boxSizing: 'border-box', fontWeight: 700,
                            boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
                        }}
                    />

                    {/* Gönder */}
                    <button
                        onClick={handleSubmit}
                        disabled={(!dVal && dVal !== '0') || submitted}
                        style={{
                            width: '100%', padding: 'clamp(10px, 2vh, 18px)',
                            borderRadius: 12, border: 'none',
                            background: submitted ? '#10b981' : 'var(--accent-primary, #E02828)',
                            color: 'white', fontSize: 'clamp(0.9rem, 2vw, 1.15rem)',
                            fontWeight: 800, letterSpacing: 2,
                            fontFamily: "'Outfit', sans-serif",
                            cursor: (!dVal && dVal !== '0') || submitted ? 'not-allowed' : 'pointer',
                            opacity: (!dVal && dVal !== '0') ? 0.35 : 1,
                            transition: 'all 0.2s',
                        }}
                    >
                        {submitted ? '✓ GÖNDERİLDİ' : 'GÖNDER'}
                    </button>

                    {/* Hızlı seçim — E panelindeki tuş takımıyla aynı görünüm */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: 'clamp(5px, 1vw, 12px)',
                    }}>
                        {rules.judgeInput.dQuickValues.map(v => {
                            const isCurrent = parseFloat(dVal) === v;
                            return (
                                <button
                                    key={v}
                                    onClick={() => !submitted && handleDValChange(String(v))}
                                    disabled={submitted}
                                    style={{
                                        aspectRatio: '5 / 3',
                                        background: isCurrent ? '#0f172a' : '#f8fafc',
                                        border: 'none', borderRadius: 10,
                                        color: isCurrent ? '#fff' : '#0f172a',
                                        fontFamily: "'Space Mono', monospace",
                                        fontSize: 'clamp(0.75rem, 1.8vw, 1.2rem)',
                                        fontWeight: 700,
                                        cursor: submitted ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 3px 10px rgba(0,0,0,0.3)',
                                        transition: 'all 0.1s',
                                    }}
                                    onPointerDown={e => { if (!submitted) e.currentTarget.style.transform = 'scale(0.92)'; }}
                                    onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    {v.toFixed(1)}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    // ── E Hakem Arayüzü ───────────────────────────────────────────────────
    return (
        <div style={{
            height: '100vh', color: '#fff', fontFamily: "'Outfit', sans-serif", overflow: 'hidden',
            background: SCREEN_BG,
            position: 'relative',
            display: 'flex', flexDirection: 'column',
        }}>
            <JudgeHeader
                connected={connected}
                roleLabel={roleLabel}
                judgeName={judgeName}
                rightText={`${athlete?.catName || '—'}${routineLabel}`}
                rightValue={eTotal.toFixed(1)}
                athleteName={athlete ? getAthleteName(athlete) : 'SPORCU BEKLENİYOR…'}
                club={athlete ? getAthleteClub(athlete) : ''}
            />

            {/* Submit Overlay — E hakem */}
            {submitted && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 200,
                    background: 'rgba(0,0,0,0.92)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 20,
                }}>
                    <div style={{
                        width: 100, height: 100, borderRadius: '50%',
                        background: 'rgba(16,185,129,0.15)',
                        border: '3px solid #10b981',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 60px rgba(16,185,129,0.4)',
                    }}>
                        <i className="material-icons-round" style={{ fontSize: 52, color: '#10b981' }}>check_circle</i>
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#10b981', letterSpacing: 2 }}>
                        PUAN GÖNDERİLDİ
                    </div>
                    <div style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '4rem', fontWeight: 700, color: 'white',
                        textShadow: '0 0 40px rgba(16,185,129,0.6)',
                    }}>
                        {eTotal.toFixed(1)}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
                        {athlete ? getAthleteName(athlete) : '—'}
                    </div>
                    <button onClick={() => setSubmitted(false)} style={correctBtnStyle}>
                        <i className="material-icons-round">edit</i> DÜZELT
                    </button>
                    <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 12, letterSpacing: 1 }}>
                        Düzeltip tekrar gönderebilirsiniz
                    </div>
                </div>
            )}

            {/* Body — tek ekran, kaydırma yok */}
            <div style={{
                flex: 1, minHeight: 0, width: '100%',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                gap: 'clamp(12px, 2.5vh, 28px)', padding: 'clamp(12px, 2vw, 28px)',
                maxWidth: 1100, margin: '0 auto', boxSizing: 'border-box',
            }}>

                {/* Kutular — #1..#N + L, hepsi tek satırda */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${slotCount}, 1fr)`,
                    gap: 'clamp(4px, 0.8vw, 10px)',
                }}>
                    {Array.from({ length: slotCount }, (_, i) => {
                        const isL = i === JUMP_COUNT;
                        const slot = i;
                        // Bu kutu puanlanıyor mu? Hayırsa görünür ama pasif.
                        const isActive = isL ? showLanding : i < shownJumps;
                        const val = isL ? landing : deductions[i];
                        const isEntered = isL ? landingEntered : entered[i];
                        const isFocused = isActive && focused === slot;
                        return (
                            <div key={isL ? 'L' : i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{
                                    textAlign: 'center',
                                    fontSize: 'clamp(0.6rem, 1.3vw, 0.8rem)',
                                    fontWeight: 800, letterSpacing: 0.5,
                                    // Gradyan zemin üzerinde #666 okunmuyordu
                                    color: !isActive ? 'rgba(255,255,255,0.28)'
                                        : isFocused ? '#ffffff' : 'rgba(255,255,255,0.8)',
                                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                                }}>
                                    {isL ? 'L' : `#${i + 1}`}
                                </div>
                                <button
                                    onClick={() => !submitted && isActive && setFocused(slot)}
                                    disabled={submitted || !isActive}
                                    title={isActive ? '' : 'Bu harekette puanlama yok'}
                                    style={{
                                        aspectRatio: '3 / 4',
                                        // Kutular referanstaki gibi her zaman açık renk;
                                        // dolu olan beyaz ve koyu yazılı, boş olan soluk.
                                        // Pasif kutu: soluk, saydam, tıklanamaz
                                        background: isActive ? '#ffffff' : 'rgba(255,255,255,0.16)',
                                        border: `3px solid ${isFocused ? '#0f172a' : 'transparent'}`,
                                        borderRadius: 8,
                                        // Boşken kutu numarası soluk gri placeholder olarak durur
                                        color: !isActive ? 'rgba(255,255,255,0.35)'
                                            : isEntered ? '#0f172a' : '#c2ccd9',
                                        fontFamily: "'Space Mono', monospace",
                                        fontSize: 'clamp(0.75rem, 1.7vw, 1.3rem)',
                                        fontWeight: 700,
                                        cursor: submitted || !isActive ? 'not-allowed' : 'pointer',
                                        boxShadow: !isActive ? 'none'
                                            : isFocused ? '0 0 0 2px rgba(0,0,0,0.25), 0 6px 18px rgba(0,0,0,0.35)'
                                            : '0 2px 6px rgba(0,0,0,0.25)',
                                        transition: 'all 0.12s',
                                        padding: 0,
                                    }}
                                >
                                    {isEntered ? val.toFixed(1) : (isL ? 'L' : i + 1)}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Gönder — CJP hareket sayısını yazmadan kilitli */}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || submitted}
                    title={canSubmit ? '' : 'Sahada sporcu yok'}
                    style={{
                        width: '100%', padding: 'clamp(10px, 2vh, 18px)',
                        borderRadius: 12, border: 'none',
                        background: submitted ? '#10b981' : 'var(--accent-primary, #E02828)',
                        color: 'white',
                        fontSize: 'clamp(0.9rem, 2vw, 1.15rem)',
                        fontWeight: 800, letterSpacing: 2,
                        fontFamily: "'Outfit', sans-serif",
                        cursor: canSubmit && !submitted ? 'pointer' : 'not-allowed',
                        opacity: canSubmit ? 1 : 0.35,
                        transition: 'all 0.2s',
                    }}
                >
                    {submitted ? '✓ GÖNDERİLDİ' : `GÖNDER  ${filledCount}/${activeCount}`}
                </button>

                {/* Ortak tuş takımı */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${KEYPAD.length + 1}, 1fr)`,
                    gap: 'clamp(5px, 1vw, 12px)',
                }}>
                    {KEYPAD.map(k => {
                        const allowed = activeOptions.includes(k / 10);
                        const isCurrent = focusedEntered &&
                            (isLandingFocused ? landing : deductions[focused]) === k / 10;
                        return (
                            <button
                                key={k}
                                onClick={() => !submitted && allowed && pressKey(k)}
                                disabled={submitted || !allowed}
                                title={allowed ? `${(k / 10).toFixed(1)}` : 'Bu kutuda geçerli değil'}
                                style={{
                                    aspectRatio: '4 / 3',
                                    // Referanstaki gibi tuşlar beyaz, 1.0 (10) vurgulu pembe
                                    background: isCurrent ? '#0f172a'
                                        : !allowed ? 'rgba(255,255,255,0.18)'
                                        : k === 10 ? '#f0a6c0' : '#f8fafc',
                                    border: 'none', borderRadius: 10,
                                    color: isCurrent ? '#fff' : allowed ? '#0f172a' : 'rgba(255,255,255,0.35)',
                                    boxShadow: allowed ? '0 3px 10px rgba(0,0,0,0.3)' : 'none',
                                    fontFamily: "'Space Mono', monospace",
                                    fontSize: 'clamp(0.9rem, 2.2vw, 1.6rem)',
                                    fontWeight: 700,
                                    cursor: submitted || !allowed ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.1s',
                                }}
                                onPointerDown={e => { if (!submitted && allowed) e.currentTarget.style.transform = 'scale(0.92)'; }}
                                onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                            >
                                {k}
                            </button>
                        );
                    })}
                    {/* Geri silme */}
                    <button
                        onClick={() => !submitted && focusedEntered && pressBackspace()}
                        disabled={submitted || !focusedEntered}
                        title="Seçili kutuyu temizle"
                        style={{
                            aspectRatio: '4 / 3',
                            background: focusedEntered ? '#f8fafc' : 'rgba(255,255,255,0.18)',
                            border: 'none', borderRadius: 10,
                            color: focusedEntered ? '#0f172a' : 'rgba(255,255,255,0.35)',
                            boxShadow: focusedEntered ? '0 3px 10px rgba(0,0,0,0.3)' : 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: submitted || !focusedEntered ? 'not-allowed' : 'pointer',
                            transition: 'all 0.1s',
                        }}
                        onPointerDown={e => { if (!submitted && focusedEntered) e.currentTarget.style.transform = 'scale(0.92)'; }}
                        onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                        <i className="material-icons-round" style={{ fontSize: 'clamp(1rem, 2.2vw, 1.6rem)' }}>backspace</i>
                    </button>
                </div>
            </div>

        </div>
    );
}

const correctBtnStyle = {
    marginTop: 24,
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.25)',
    color: 'white', borderRadius: 12,
    padding: '14px 28px', fontSize: '1rem', fontWeight: 700,
    letterSpacing: 1, cursor: 'pointer',
    fontFamily: "'Outfit', sans-serif",
};

// ── Ortak Başlık ──────────────────────────────────────────────────────────
// E ve D ekranları aynı başlığı kullanır: üstte hakem (rol + adı) ve sağda
// kategori/seri + anlık değer, altındaki açık şeritte sahadaki sporcu + kulüp.
function JudgeHeader({ connected, roleLabel, judgeName, rightText, rightValue, athleteName, club }) {
    return (
        <header style={{ flexShrink: 0, zIndex: 100 }}>
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'clamp(6px, 1.2vh, 12px) clamp(14px, 2.5vw, 28px)', gap: 12,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{
                        width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                        background: connected ? '#4ade80' : '#64748b',
                        boxShadow: connected ? '0 0 10px #4ade80' : 'none',
                    }} />
                    <span style={{
                        fontWeight: 800, fontSize: 'clamp(0.85rem, 1.9vw, 1.25rem)',
                        letterSpacing: 1, flexShrink: 0,
                    }}>
                        {roleLabel}
                    </span>
                    {judgeName && (
                        <span style={{
                            fontWeight: 600, fontSize: 'clamp(0.8rem, 1.7vw, 1.15rem)',
                            color: 'rgba(255,255,255,0.92)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {judgeName}
                        </span>
                    )}
                </div>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 'clamp(10px, 2vw, 24px)',
                    fontSize: 'clamp(0.7rem, 1.5vw, 1rem)', fontWeight: 600,
                    color: 'rgba(255,255,255,0.85)', minWidth: 0,
                }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rightText}
                    </span>
                    <span style={{
                        fontFamily: "'Space Mono', monospace", fontWeight: 700,
                        background: 'rgba(0,0,0,0.25)', padding: '2px 10px', borderRadius: 6,
                        flexShrink: 0,
                    }}>
                        {rightValue}
                    </span>
                </div>
            </div>
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(255,255,255,0.14)',
                padding: 'clamp(4px, 0.9vh, 9px) clamp(14px, 2.5vw, 28px)', gap: 12,
            }}>
                <span style={{
                    fontWeight: 700, fontSize: 'clamp(0.78rem, 1.7vw, 1.1rem)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {athleteName}
                </span>
                <span style={{
                    fontWeight: 700, fontSize: 'clamp(0.7rem, 1.5vw, 1rem)',
                    color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {club}
                </span>
            </div>
        </header>
    );
}

// E ve D ekranlarının ortak zemini
const SCREEN_BG = 'linear-gradient(115deg, #3b1d8f 0%, #6d1f7a 45%, #b81f3a 78%, #d92036 100%)';
