/**
 * JudgeCockpitPage.jsx
 * Mevcut judge_cockpit.html + judge_cockpit.js — E-Hakem kesinti girişi
 *
 * Çalışma mantığı (aynen korundu):
 * - 10 sıçrama × {0.0, 0.1, 0.2, 0.3, 0.4, 0.5} kesinti
 * - İniş (Landing) × {0.0, 0.1, 0.2, 0.3}
 * - Her tapa sonrası sonraki hareket otomatik odaklanır (Flow UX)
 * - DataStore.syncJudgeState ile CJP'ye canlı gönderim
 * - DataStore.onLiveUpdate ile aktif sporcu değişimini dinler
 * - Şifre kapısı: PasswordGate → PasswordGateComponent
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataStore } from '../lib/DataService';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import PasswordGate from '../components/PasswordGate';

const DEDUCT_OPTIONS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
const LANDING_OPTIONS = [0.0, 0.1, 0.2, 0.3];
const JUMP_COUNT = 10;

const judgeSessionId = 'judge_' + Math.floor(Math.random() * 9000 + 1000);

export default function JudgeCockpitPage() {
    const [params] = useSearchParams();
    const { checkJudgeAccess, saveJudgeSession, isJudgeSessionValid, startInactivityTimer, clearJudgeSession } = useAuth();
    const { toast } = useNotification();

    const compId = params.get('comp') || localStorage.getItem('tra_active_comp');
    const role   = params.get('role') || 'judge-e';
    const judgeN = params.get('id') || '1';
    const panel  = params.get('panel') || 'A';
    const roleLabel = role === 'judge-d' ? 'D (ZORLUK)' : `E${judgeN}`;

    const [unlocked, setUnlocked] = useState(false);
    const [noPassword, setNoPassword] = useState(false);

    // Scoring state
    const [scores, setScores] = useState(Array(JUMP_COUNT).fill(0));
    const [landing, setLanding] = useState(0);
    const [focused, setFocused] = useState(0);
    const [athlete, setAthlete] = useState(null);
    const [connected, setConnected] = useState(false);

    const liveUnsubRef = useRef(null);

    // ── Şifre Kapısı Kontrolü ─────────────────────────────────────────────
    useEffect(() => {
        if (!compId) return;
        (async () => {
            if (isJudgeSessionValid(compId, panel, role)) {
                setUnlocked(true);
                return;
            }
            const result = await checkJudgeAccess(compId, panel, role);
            if (result === 'no_password') {
                setNoPassword(true);
                setUnlocked(true);
            }
            // Eğer şifre varsa, PasswordGate bileşeni gösterilir
        })();
    }, [compId, panel, role]);

    // ── Canlı Sporcu Listener ─────────────────────────────────────────────
    useEffect(() => {
        if (!unlocked || !compId) return;
        setConnected(true);

        liveUnsubRef.current = DataStore.onLiveUpdate(compId, (data) => {
            if (data?.athlete) {
                setAthlete(prev => {
                    if (prev?.id !== data.athlete.id) {
                        // Yeni sporcu → reset
                        setScores(Array(JUMP_COUNT).fill(0));
                        setLanding(0);
                        setFocused(0);
                        if (navigator.vibrate) navigator.vibrate(200);
                        return data.athlete;
                    }
                    return prev;
                });
            }
        });

        return () => {
            if (liveUnsubRef.current) liveUnsubRef.current();
        };
    }, [unlocked, compId]);

    // ── İnaktivite timer ──────────────────────────────────────────────────
    useEffect(() => {
        if (!unlocked) return;
        startInactivityTimer(() => {
            clearJudgeSession();
            setUnlocked(false);
        });
    }, [unlocked]);

    // ── Puan hesap ────────────────────────────────────────────────────────
    const total = scores.reduce((a, b) => a + b, 0) + landing;

    // ── Tap: Sıçrama butonu ───────────────────────────────────────────────
    const tap = useCallback((index, val) => {
        setScores(prev => {
            const next = [...prev];
            next[index] = val;
            return next;
        });
        // Flow: sonraki harekete geç
        if (index < JUMP_COUNT - 1) setFocused(index + 1);
        else setFocused(JUMP_COUNT); // landing focus
        syncLive(null, index, val);
    }, []);

    const tapLanding = useCallback((val) => {
        setLanding(val);
        syncLive(val, null, null);
    }, [scores]);

    // ── Canlı Sync ────────────────────────────────────────────────────────
    const syncLive = async (newLanding, jumpIdx, jumpVal) => {
        if (!compId || !athlete) return;
        const currentScores = jumpIdx !== null
            ? scores.map((s, i) => i === jumpIdx ? jumpVal : s)
            : [...scores];
        const currentLanding = newLanding !== null ? newLanding : landing;

        await DataStore.syncJudgeState(compId, judgeSessionId, {
            judgeId: judgeSessionId,
            role: roleLabel,
            scores: currentScores,
            landing: currentLanding,
            lastUpdate: Date.now(),
        });
    };

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
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: connected ? '#00ff00' : '#333',
                        boxShadow: connected ? '0 0 10px #00ff00' : 'none',
                        marginRight: 10,
                    }} />
                    <div>
                        <div style={{ fontSize: '0.8rem', letterSpacing: 2, color: '#888', textTransform: 'uppercase' }}>
                            HAKEM {roleLabel}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                            {athlete ? `${athlete.surname} ${athlete.name}` : 'SPORCU BEKLENİYOR...'}
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
            <div style={{ paddingTop: 80, paddingBottom: 110, overflowY: 'auto', height: '100vh', scrollBehavior: 'smooth' }}>
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

            {/* Total Bar */}
            <div style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, height: 100,
                background: 'linear-gradient(to top, #000, transparent)',
                display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
                paddingBottom: 20, pointerEvents: 'none',
            }}>
                <div style={{
                    background: 'var(--accent-primary, #F43F5E)', color: 'white',
                    padding: '10px 40px', borderRadius: 50,
                    fontFamily: "'Space Mono', monospace", fontSize: '1.5rem', fontWeight: 700,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                    pointerEvents: 'auto',
                }}>
                    {total.toFixed(1)}
                </div>
            </div>
        </div>
    );
}

// ── JumpCard Alt Bileşeni ─────────────────────────────────────────────────
function JumpCard({ index, value, isFocused, options, onTap, label }) {
    const ref = useRef(null);

    useEffect(() => {
        if (isFocused && ref.current) {
            ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isFocused]);

    const deductColors = {
        0.3: { bg: '#ffaa00', color: '#000' },
        0.4: { bg: '#ff5500', color: '#fff' },
        0.5: { bg: '#ff0000', color: '#fff' },
    };

    return (
        <div
            ref={ref}
            style={{
                width: '100%',
                background: isFocused ? '#161616' : '#111',
                border: `1px solid ${isFocused ? 'var(--accent-primary, #F43F5E)' : '#222'}`,
                borderRadius: 16,
                padding: 15,
                display: 'grid',
                gridTemplateColumns: '50px 1fr',
                transition: 'all 0.2s',
                transform: isFocused ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isFocused ? '0 0 30px rgba(244,63,94,0.15)' : 'none',
            }}
        >
            {/* Numara */}
            <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '1.5rem',
                color: isFocused ? 'var(--accent-primary, #F43F5E)' : '#444',
                fontWeight: isFocused ? 700 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                {label || index + 1}
            </div>

            {/* Butonlar */}
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
                                border: 'none',
                                borderRadius: 8,
                                color: isSelected ? (dc ? dc.color : '#000') : '#888',
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '1rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.1s',
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
