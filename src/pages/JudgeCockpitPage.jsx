/**
 * JudgeCockpitPage.jsx
 * Mevcut judge_cockpit.html + judge_cockpit.js — E/D Hakem kesinti girişi
 *
 * Düzeltmeler (HTML ile eşleştirildi):
 * - Hakem verisi doğru Firebase path'e yazılıyor:
 *   live/{compId}/panels/{panel}/scores/judges/{judgeKey}
 * - judgeKey URL'den türetiliyor: e1..e6 veya d1
 * - Aktif sporcu panel-specific activeContext'ten dinleniyor
 * - Submit butonu gerçekten submitted:true flag'i gönderiyor
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
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

    // Hakem anahtarı: CJP'nin beklediği format — e1..e6 veya d1
    const judgeKey  = role === 'judge-d' ? 'd1' : `e${judgeN}`;
    const roleLabel = role === 'judge-d' ? 'D (ZORLUK)' : `E${judgeN}`;

    const [unlocked, setUnlocked]   = useState(false);
    const [noPassword, setNoPassword] = useState(false);
    const [scores, setScores]       = useState(Array(JUMP_COUNT).fill(0));
    const [landing, setLanding]     = useState(0);
    const [focused, setFocused]     = useState(0);
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

        // Panel-specific activeContext'i dinle (HTML cjp.html ile aynı path)
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
                            setScores(Array(JUMP_COUNT).fill(0));
                            setLanding(0);
                            setFocused(0);
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

    // ── Toplam ────────────────────────────────────────────────────────────
    const total = scores.reduce((a, b) => a + b, 0) + landing;

    // ── Firebase'e yaz ───────────────────────────────────────────────────
    // Doğru path: live/{compId}/panels/{panel}/scores/judges/{judgeKey}
    const writePath = `live/${compId}/panels/${panel}/scores/judges/${judgeKey}`;

    async function syncLive(newScores, newLanding, isSubmit = false) {
        if (!compId || !athlete) return;
        const data = {
            judgeId:   judgeKey,
            role:      roleLabel,
            scores:    newScores,   // per-element deductions array
            landing:   newLanding,
            lastUpdate: Date.now(),
            submitted: isSubmit,
        };
        try {
            await set(ref(db, writePath), data);
        } catch (e) {
            console.error('syncLive error:', e);
        }
    }

    // ── Tap: Sıçrama ──────────────────────────────────────────────────────
    const tap = useCallback((index, val) => {
        setScores(prev => {
            const next = [...prev];
            next[index] = val;
            syncLive(next, landing, false);
            return next;
        });
        setSubmitted(false);
        if (index < JUMP_COUNT - 1) setFocused(index + 1);
        else setFocused(JUMP_COUNT);
    }, [landing, athlete]);

    const tapLanding = useCallback((val) => {
        setLanding(val);
        syncLive(scores, val, false);
        setSubmitted(false);
    }, [scores, athlete]);

    // ── Submit ────────────────────────────────────────────────────────────
    async function handleSubmit() {
        await syncLive(scores, landing, true);
        setSubmitted(true);
    }

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
                            {athlete ? `${athlete.surname || ''} ${athlete.name || ''}`.trim() : 'SPORCU BEKLENİYOR...'}
                        </div>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: '#888' }}>KESİNTİ TOPLAMI</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '1.5rem', color: 'white' }}>
                        {total.toFixed(1)}
                    </div>
                </div>
            </header>

            {/* Body */}
            <div style={{ paddingTop: 80, paddingBottom: 120, overflowY: 'auto', height: '100vh', scrollBehavior: 'smooth' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15, padding: 20, maxWidth: 600, margin: '0 auto' }}>

                    {/* 10 Sıçrama */}
                    {Array.from({ length: JUMP_COUNT }, (_, i) => (
                        <JumpCard
                            key={i}
                            index={i}
                            value={scores[i]}
                            isFocused={focused === i}
                            options={DEDUCT_OPTIONS}
                            onTap={(val) => tap(i, val)}
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
                    {total.toFixed(1)}
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
function JumpCard({ index, value, isFocused, options, onTap, label }) {
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
                            onClick={() => onTap(val)}
                            style={{
                                aspectRatio: 1,
                                background: isSelected ? (dc ? dc.bg : '#fff') : '#222',
                                border: 'none', borderRadius: 8,
                                color: isSelected ? (dc ? dc.color : '#000') : '#888',
                                fontFamily: "'Space Mono', monospace", fontSize: '1rem',
                                fontWeight: 700, cursor: 'pointer', transition: 'all 0.1s',
                                boxShadow: isSelected && !dc ? '0 0 15px rgba(255,255,255,0.5)' : 'none',
                            }}
                            onPointerDown={e => { e.currentTarget.style.transform = 'scale(0.9)'; }}
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
