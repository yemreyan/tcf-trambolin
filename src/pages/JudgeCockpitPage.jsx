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
const LANDING_OPTIONS = [0.0, 0.1, 0.2, 0.3];
const JUMP_COUNT = 10;

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

    // D hakem state — tek zorluk değeri
    const [dVal, setDVal]           = useState('');

    const [athlete, setAthlete]     = useState(null);
    const [submitted, setSubmitted] = useState(false);
    const [connected, setConnected] = useState(false);

    const unsubRef = useRef(null);

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
                if (currentAth) {
                    setAthlete(prev => {
                        const prevId = prev?.uniqueId || prev?.id;
                        const newId  = currentAth?.uniqueId || currentAth?.id;
                        if (prevId !== newId) {
                            // Yeni sporcu → tümünü sıfırla
                            setDeductions(Array(JUMP_COUNT).fill(0));
                            setLanding(0);
                            setFocused(0);
                            setDVal('');
                            setSubmitted(false);
                            if (navigator.vibrate) navigator.vibrate(200);
                        }
                        return currentAth;
                    });
                }
            }
        );

        return () => { if (unsubRef.current) unsubRef.current(); };
    }, [unlocked, compId, panel]);

    // ── İnaktivite ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!unlocked) return;
        startInactivityTimer(() => { clearJudgeSession(); setUnlocked(false); });
    }, [unlocked]);

    // ── Firebase'e yaz ───────────────────────────────────────────────────
    // Doğru path: live/{compId}/panels/{panel}/scores/judges/{judgeKey}
    const writePath = `live/${compId}/panels/${panel}/scores/judges/${judgeKey}`;

    async function syncLive(payload, isSubmit = false) {
        if (!compId || !athlete) return;
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
    const tap = useCallback((index, val) => {
        setDeductions(prev => {
            const next = [...prev];
            next[index] = val;
            syncLive({ deductions: next, landing }, false);
            return next;
        });
        setSubmitted(false);
        if (index < JUMP_COUNT - 1) setFocused(index + 1);
        else setFocused(JUMP_COUNT);
    }, [landing, athlete]);

    const tapLanding = useCallback((val) => {
        setLanding(val);
        syncLive({ deductions, landing: val }, false);
        setSubmitted(false);
    }, [deductions, athlete]);

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
            await syncLive({ deductions, landing }, true);
        }
        setSubmitted(true);
    }

    // ── E hakem toplam ────────────────────────────────────────────────────
    const eTotal = deductions.reduce((a, b) => a + b, 0) + landing;

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
                                HAKEM {roleLabel}
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
                        <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 20, letterSpacing: 1 }}>
                            Yeni sporcu çağrıldığında ekran açılır
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
        <div style={{ background: '#050505', color: '#fff', minHeight: '100vh', fontFamily: "'Outfit', sans-serif", overflow: 'hidden' }}>
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
                            HAKEM {roleLabel}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                            {athlete ? getAthleteName(athlete) : 'SPORCU BEKLENİYOR...'}
                        </div>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: '#888' }}>KESİNTİ TOPLAMI</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '1.5rem', color: 'white' }}>
                        {eTotal.toFixed(1)}
                    </div>
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
                    <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 20, letterSpacing: 1 }}>
                        Yeni sporcu çağrıldığında ekran açılır
                    </div>
                </div>
            )}

            {/* Body */}
            <div style={{ paddingTop: 80, paddingBottom: 120, overflowY: 'auto', height: '100vh', scrollBehavior: 'smooth' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15, padding: 20, maxWidth: 600, margin: '0 auto' }}>

                    {/* 10 Sıçrama */}
                    {Array.from({ length: JUMP_COUNT }, (_, i) => (
                        <JumpCard
                            key={i}
                            index={i}
                            value={deductions[i]}
                            isFocused={focused === i}
                            options={DEDUCT_OPTIONS}
                            onTap={(val) => tap(i, val)}
                            disabled={submitted}
                        />
                    ))}

                    {/* İniş */}
                    <div style={{ width: '100%', borderTop: '1px dashed #333', paddingTop: 15 }}>
                        <JumpCard
                            index="L"
                            value={landing}
                            isFocused={focused === JUMP_COUNT}
                            options={LANDING_OPTIONS}
                            onTap={tapLanding}
                            label="İNİŞ (L)"
                            disabled={submitted}
                        />
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
                {/* Toplam pill */}
                <div style={{
                    background: submitted ? '#10b981' : 'var(--accent-primary, #F43F5E)',
                    color: 'white',
                    padding: '10px 30px', borderRadius: 50,
                    fontFamily: "'Space Mono', monospace", fontSize: '1.4rem', fontWeight: 700,
                    boxShadow: submitted ? '0 0 20px rgba(16,185,129,0.5)' : '0 10px 30px rgba(0,0,0,0.5)',
                    transition: 'all 0.3s',
                }}>
                    {eTotal.toFixed(1)}
                </div>
                {/* Submit butonu */}
                <button
                    onClick={handleSubmit}
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

// ── JumpCard Alt Bileşeni ─────────────────────────────────────────────────
function JumpCard({ index, value, isFocused, options, onTap, label, disabled }) {
    const cardRef = useRef(null);

    useEffect(() => {
        if (isFocused && cardRef.current) {
            cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isFocused]);

    const deductColors = {
        0.3: { bg: '#ffaa00', color: '#000' },
        0.4: { bg: '#ff5500', color: '#fff' },
        0.5: { bg: '#ff0000', color: '#fff' },
    };

    return (
        <div
            ref={cardRef}
            style={{
                width: '100%',
                background: isFocused ? '#161616' : '#111',
                border: `1px solid ${isFocused ? 'var(--accent-primary, #F43F5E)' : '#222'}`,
                borderRadius: 16, padding: 15,
                display: 'grid', gridTemplateColumns: '50px 1fr',
                transition: 'all 0.2s',
                transform: isFocused ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isFocused ? '0 0 30px rgba(244,63,94,0.15)' : 'none',
            }}
        >
            <div style={{
                fontFamily: "'Space Mono', monospace", fontSize: '1.5rem',
                color: isFocused ? 'var(--accent-primary, #F43F5E)' : '#444',
                fontWeight: isFocused ? 700 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                {label || index + 1}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 8 }}>
                {options.map(val => {
                    const isSelected = value === val;
                    const dc = isSelected && deductColors[val];
                    return (
                        <button
                            key={val}
                            onClick={() => !disabled && onTap(val)}
                            disabled={disabled}
                            style={{
                                aspectRatio: 1,
                                background: isSelected ? (dc ? dc.bg : '#fff') : '#222',
                                border: 'none', borderRadius: 8,
                                color: isSelected ? (dc ? dc.color : '#000') : '#888',
                                fontFamily: "'Space Mono', monospace", fontSize: '1rem',
                                fontWeight: 700,
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                transition: 'all 0.1s',
                                opacity: disabled ? 0.5 : 1,
                                boxShadow: isSelected && !dc ? '0 0 15px rgba(255,255,255,0.5)' : 'none',
                            }}
                            onPointerDown={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.9)'; }}
                            onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                        >
                            {val}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
