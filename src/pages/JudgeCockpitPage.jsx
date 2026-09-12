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

const DEDUCT_OPTIONS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
const LANDING_OPTIONS = [0.0, 0.1, 0.2, 0.3, 0.5, 1.0];
const JUMP_COUNT = 10;

// Ortak tuş takımı — onda birlik tam sayı olarak yazılır (3 → 0.3, 10 → 1.0).
// Seçili kutunun izin verdiği değerler dışındakiler pasifleşir: sıçramada
// 1.0, inişte 0.4 geçerli değil.
const KEYPAD = [0, 1, 2, 3, 4, 5, 10];

export default function JudgeCockpitPage() {
    const [params] = useSearchParams();
    const { checkJudgeAccess, saveJudgeSession, isJudgeSessionValid, startInactivityTimer, clearJudgeSession } = useAuth();

    const compId  = params.get('comp')  || localStorage.getItem('tra_active_comp');
    const role    = params.get('role')  || 'judge-e';
    const judgeN  = params.get('id')    || '1';
    const panel   = params.get('panel') || 'A';

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
    }, []);

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
    }, []);

    // ── Hakemin adı ───────────────────────────────────────────────────────
    // URL'deki panel parametresi jüri paneli id'si ile aynı (JuryPage linkleri
    // böyle üretiyor), isim oradaki members listesinden okunur.
    useEffect(() => {
        if (!compId || !panel) return;
        const unsub = onValue(
            ref(db, `competitions/${compId}/juryPanels/${panel}/members`),
            snap => {
                const m = snap.val() || {};
                // D hakeminde jüri listesi d1/d2 tutuyor ama ekran anahtarı 'd'
                const raw = isD ? (m[`d${judgeN}`] ?? m.d1 ?? m.d) : m[judgeKey];
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
            if (unsubRef.current) unsubRef.current();
            if (ownUnsubRef.current) ownUnsubRef.current();
        };
    }, [unlocked, compId, panel, judgeKey, resetEntry, hydrateFrom]);

    // ── İnaktivite ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!unlocked) return;
        startInactivityTimer(() => { clearJudgeSession(); setUnlocked(false); });
    }, [unlocked]);

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

    // ── Ortak tuş takımı ──────────────────────────────────────────────────
    const isLandingFocused = focused === JUMP_COUNT;
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
    const shownJumps = elementCount || JUMP_COUNT;
    const eTotal = deductions.slice(0, shownJumps).reduce((a, b) => a + b, 0) + landing;

    // Gönderim hazır mı — CJP eleman sayısını yazmadan puanlanacak eleman
    // sayısı bilinmiyor, referans sistemde olduğu gibi gönderim kilitlenir.
    const canSubmit = elementCount !== null && !!athlete;
    const filledCount = entered.slice(0, shownJumps).filter(Boolean).length + (landingEntered ? 1 : 0);

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
    if (isD) {
        return (
            <div style={{ background: '#050505', color: '#fff', minHeight: '100vh', fontFamily: "'Outfit', sans-serif" }}>
                {/* Header */}
                <header style={{
                    position: 'fixed', top: 0, left: 0, right: 0, height: 70,
                    background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(10px)',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0 20px', zIndex: 100,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: connected ? '#00ff00' : '#333',
                            boxShadow: connected ? '0 0 10px #00ff00' : 'none',
                        }} />
                        <div>
                            <div style={{ fontSize: '0.8rem', letterSpacing: 2, color: '#888', textTransform: 'uppercase' }}>
                                HAKEM {roleLabel}{judgeName ? ` · ${judgeName}` : ''}
                            </div>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                                {athlete ? getAthleteName(athlete) : 'SPORCU BEKLENİYOR...'}
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', color: '#888' }}>ZORLUK</div>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '1.5rem', color: 'white' }}>
                            {parseFloat(dVal || 0).toFixed(1)}
                        </div>
                    </div>
                </header>

                {/* Submit Overlay — puanlar gönderildikten sonra ekranı kilitle */}
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
                            {parseFloat(dVal || 0).toFixed(1)}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#64748b', marginTop: 8 }}>
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

            {/* Body — D hakem tek değer girişi */}
                <div style={{ paddingTop: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '90px 24px 160px', maxWidth: 500, margin: '0 auto' }}>
                    <div style={{ fontSize: '0.9rem', color: '#888', letterSpacing: 2, marginBottom: 24, textAlign: 'center' }}>
                        ZORLUK DEĞERİ (D)
                    </div>

                    {/* Büyük sayı göstergesi */}
                    <div style={{
                        background: submitted ? 'rgba(16,185,129,0.15)' : '#111',
                        border: `2px solid ${submitted ? '#10b981' : '#333'}`,
                        borderRadius: 24, padding: '40px 60px', marginBottom: 32, textAlign: 'center',
                        boxShadow: submitted ? '0 0 30px rgba(16,185,129,0.3)' : 'none',
                        transition: 'all 0.3s',
                    }}>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '4rem', fontWeight: 700, color: submitted ? '#10b981' : 'white' }}>
                            {parseFloat(dVal || 0).toFixed(1)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#888', marginTop: 8 }}>ZORLUK PUANI</div>
                    </div>

                    {/* Sayı klavyesi */}
                    <div style={{
                        background: '#111', border: '1px solid #222', borderRadius: 16, padding: 20, width: '100%',
                    }}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: 8, letterSpacing: 1 }}>
                                DEĞER GİRİN
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="20"
                                value={dVal}
                                onChange={e => handleDValChange(e.target.value)}
                                placeholder="0.0"
                                style={{
                                    width: '100%', background: '#0a0a0a', border: '1px solid #333',
                                    borderRadius: 12, padding: '16px 20px', color: 'white',
                                    fontFamily: "'Space Mono', monospace", fontSize: '2rem', textAlign: 'center',
                                    outline: 'none', boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        {/* Hızlı seçim butonları (yaygın D değerleri) */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                            {[7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5].map(v => (
                                <button
                                    key={v}
                                    onClick={() => handleDValChange(String(v))}
                                    style={{
                                        padding: '12px 4px',
                                        background: parseFloat(dVal) === v ? '#F43F5E' : '#1a1a1a',
                                        border: `1px solid ${parseFloat(dVal) === v ? '#F43F5E' : '#333'}`,
                                        borderRadius: 8, color: parseFloat(dVal) === v ? 'white' : '#888',
                                        fontFamily: "'Space Mono', monospace", fontSize: '0.85rem',
                                        fontWeight: 700, cursor: 'pointer', transition: 'all 0.1s',
                                    }}
                                    onPointerDown={e => { e.currentTarget.style.transform = 'scale(0.92)'; }}
                                    onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    {v.toFixed(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Submit Bar */}
                <div style={{
                    position: 'fixed', bottom: 0, left: 0, right: 0, height: 110,
                    background: 'linear-gradient(to top, #000 60%, transparent)',
                    display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
                    paddingBottom: 20, gap: 16,
                }}>
                    <div style={{
                        background: submitted ? '#10b981' : '#F43F5E',
                        color: 'white', padding: '10px 30px', borderRadius: 50,
                        fontFamily: "'Space Mono', monospace", fontSize: '1.4rem', fontWeight: 700,
                        boxShadow: submitted ? '0 0 20px rgba(16,185,129,0.5)' : '0 10px 30px rgba(0,0,0,0.5)',
                        transition: 'all 0.3s',
                    }}>
                        {parseFloat(dVal || 0).toFixed(1)}
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={!dVal && dVal !== '0'}
                        style={{
                            background: submitted ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.1)',
                            border: `2px solid ${submitted ? '#10b981' : 'rgba(255,255,255,0.3)'}`,
                            color: submitted ? '#10b981' : 'white',
                            padding: '10px 24px', borderRadius: 50,
                            fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
                            transition: 'all 0.3s',
                        }}
                    >
                        {submitted ? '✓ GÖNDERİLDİ' : 'GÖNDER'}
                    </button>
                </div>
            </div>
        );
    }

    // ── E Hakem Arayüzü ───────────────────────────────────────────────────
    return (
        <div style={{
            height: '100vh', color: '#fff', fontFamily: "'Outfit', sans-serif", overflow: 'hidden',
            background: 'linear-gradient(115deg, #3b1d8f 0%, #6d1f7a 45%, #b81f3a 78%, #d92036 100%)',
            position: 'relative',
            display: 'flex', flexDirection: 'column',
        }}>
            {/* Başlık — üstte hakem, altında sahadaki sporcu */}
            <header style={{ flexShrink: 0, zIndex: 100 }}>
                {/* Satır 1: hakem + kategori/seri + kesinti toplamı */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'clamp(6px, 1.2vh, 12px) clamp(14px, 2.5vw, 28px)',
                    gap: 12,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{
                            width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                            background: connected ? '#4ade80' : '#64748b',
                            boxShadow: connected ? '0 0 10px #4ade80' : 'none',
                        }} />
                        <span style={{
                            fontWeight: 800, fontSize: 'clamp(0.85rem, 1.9vw, 1.25rem)', letterSpacing: 1,
                            flexShrink: 0,
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
                            {athlete?.catName || '—'}{routineLabel}
                        </span>
                        <span style={{
                            fontFamily: "'Space Mono', monospace", fontWeight: 700,
                            background: 'rgba(0,0,0,0.25)', padding: '2px 10px', borderRadius: 6,
                            flexShrink: 0,
                        }}>
                            {eTotal.toFixed(1)}
                        </span>
                    </div>
                </div>
                {/* Satır 2: sahadaki sporcu + kulüp */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(255,255,255,0.14)',
                    padding: 'clamp(4px, 0.9vh, 9px) clamp(14px, 2.5vw, 28px)',
                    gap: 12,
                }}>
                    <span style={{
                        fontWeight: 700, fontSize: 'clamp(0.78rem, 1.7vw, 1.1rem)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {athlete ? getAthleteName(athlete) : 'SPORCU BEKLENİYOR…'}
                    </span>
                    <span style={{
                        fontWeight: 700, fontSize: 'clamp(0.7rem, 1.5vw, 1rem)',
                        color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {athlete ? getAthleteClub(athlete) : ''}
                    </span>
                </div>
            </header>

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
                {/* CJP eleman sayısını yazmadıysa uyar */}
                {athlete && elementCount === null && (
                    <div style={{
                        background: 'rgba(234,179,8,0.12)',
                        border: '1px solid rgba(234,179,8,0.4)', borderRadius: 12,
                        padding: '10px 16px', color: '#eab308',
                        fontSize: 'clamp(0.75rem, 1.6vw, 0.95rem)',
                        fontWeight: 600, textAlign: 'center',
                    }}>
                        Başhakem hareket sayısını henüz girmedi — gönderim kapalı.
                    </div>
                )}

                {/* Kutular — #1..#N + L, hepsi tek satırda */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${shownJumps + 1}, 1fr)`,
                    gap: 'clamp(4px, 0.8vw, 10px)',
                }}>
                    {Array.from({ length: shownJumps + 1 }, (_, i) => {
                        const isL = i === shownJumps;
                        const slot = isL ? JUMP_COUNT : i;
                        const val = isL ? landing : deductions[i];
                        const isEntered = isL ? landingEntered : entered[i];
                        const isFocused = focused === slot;
                        return (
                            <div key={isL ? 'L' : i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{
                                    textAlign: 'center',
                                    fontSize: 'clamp(0.6rem, 1.3vw, 0.8rem)',
                                    fontWeight: 700, letterSpacing: 0.5,
                                    color: isFocused ? 'var(--accent-primary, #F43F5E)' : '#666',
                                }}>
                                    {isL ? 'L' : `#${i + 1}`}
                                </div>
                                <button
                                    onClick={() => !submitted && setFocused(slot)}
                                    disabled={submitted}
                                    style={{
                                        aspectRatio: '3 / 4',
                                        // Kutular referanstaki gibi her zaman açık renk;
                                        // dolu olan beyaz ve koyu yazılı, boş olan soluk.
                                        background: isEntered ? '#ffffff' : 'rgba(255,255,255,0.72)',
                                        border: `3px solid ${isFocused ? '#ffffff' : 'transparent'}`,
                                        borderRadius: 8,
                                        color: '#0f172a',
                                        fontFamily: "'Space Mono', monospace",
                                        fontSize: 'clamp(0.75rem, 1.7vw, 1.3rem)',
                                        fontWeight: 700,
                                        cursor: submitted ? 'not-allowed' : 'pointer',
                                        boxShadow: isFocused ? '0 0 0 2px rgba(0,0,0,0.25), 0 6px 18px rgba(0,0,0,0.35)' : '0 2px 6px rgba(0,0,0,0.25)',
                                        transition: 'all 0.12s',
                                        padding: 0,
                                    }}
                                >
                                    {isEntered ? val.toFixed(1) : ''}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Gönder — CJP hareket sayısını yazmadan kilitli */}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || submitted}
                    title={canSubmit ? '' : 'Başhakem hareket sayısını girmeden gönderilemez'}
                    style={{
                        width: '100%', padding: 'clamp(10px, 2vh, 18px)',
                        borderRadius: 12, border: 'none',
                        background: submitted ? '#10b981' : 'var(--accent-primary, #F43F5E)',
                        color: 'white',
                        fontSize: 'clamp(0.9rem, 2vw, 1.15rem)',
                        fontWeight: 800, letterSpacing: 2,
                        fontFamily: "'Outfit', sans-serif",
                        cursor: canSubmit && !submitted ? 'pointer' : 'not-allowed',
                        opacity: canSubmit ? 1 : 0.35,
                        transition: 'all 0.2s',
                    }}
                >
                    {submitted ? '✓ GÖNDERİLDİ' : `GÖNDER  ${filledCount}/${shownJumps + 1}`}
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
