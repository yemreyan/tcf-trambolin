/**
 * PasswordGate.jsx
 * Mevcut auth.js showGate() görsel tasarımını React'e taşır.
 * Hakem / CJP ekranlarında tam ekran şifre kapısı olarak kullanılır.
 */

import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';

export default function PasswordGate({ compId, panel, role, onUnlock, label }) {
    const { verifyJudgePassword } = useAuth();
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit() {
        if (!password.trim()) return;
        setLoading(true);
        setError('');

        const ok = await verifyJudgePassword(compId, panel, role, password.trim());
        setLoading(false);

        if (ok) {
            onUnlock();
        } else {
            setError('Yanlış şifre. Lütfen tekrar deneyin.');
            setPassword('');
            // Shake animasyonu için kısa delay
            setTimeout(() => setError(''), 3000);
        }
    }

    return (
        <div className="gate-overlay">
            <div className="gate-card">
                {/* İkon */}
                <div className="gate-icon">
                    <i className="material-icons-round" style={{ fontSize: 40, color: 'white' }}>lock</i>
                </div>

                {/* Başlık */}
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white', marginBottom: 8 }}>
                    Şifre Gerekli
                </div>
                <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: 6 }}>
                    Bu ekrana erişmek için şifrenizi giriniz
                </div>
                {label && (
                    <div style={{
                        background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)',
                        borderRadius: 8, padding: '6px 14px', fontSize: '0.82rem', color: '#38bdf8',
                        fontWeight: 700, letterSpacing: 1, marginBottom: 24, display: 'inline-block',
                    }}>
                        {label}
                    </div>
                )}

                {/* Input */}
                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    placeholder="••••••"
                    autoFocus
                    style={{
                        width: '100%',
                        padding: '16px 20px',
                        fontSize: '1.2rem',
                        textAlign: 'center',
                        background: 'rgba(0,0,0,0.3)',
                        border: `2px solid ${error ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 12,
                        color: 'white',
                        fontFamily: "'Outfit', sans-serif",
                        letterSpacing: 4,
                        marginBottom: 16,
                        boxSizing: 'border-box',
                        transition: 'border-color 0.3s',
                        outline: 'none',
                    }}
                />

                {/* Giriş Butonu */}
                <button
                    onClick={handleSubmit}
                    disabled={loading || !password}
                    style={{
                        width: '100%',
                        padding: 16,
                        background: loading
                            ? 'rgba(16,185,129,0.5)'
                            : 'linear-gradient(135deg, #10b981, #059669)',
                        border: 'none',
                        borderRadius: 12,
                        color: 'white',
                        fontSize: '1rem',
                        fontWeight: 700,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        transition: 'all 0.3s',
                        fontFamily: "'Outfit', sans-serif",
                    }}
                >
                    <i className="material-icons-round">
                        {loading ? 'hourglass_empty' : 'vpn_key'}
                    </i>
                    {loading ? 'KONTROL EDİLİYOR...' : 'GİRİŞ YAP'}
                </button>

                {/* Hata */}
                {error && (
                    <div style={{
                        color: '#ef4444', fontSize: '0.9rem', marginTop: 14,
                        animation: 'shake 0.5s ease',
                    }}>
                        {error}
                    </div>
                )}

                <style>{`
                    @keyframes shake {
                        0%, 100% { transform: translateX(0); }
                        25% { transform: translateX(-10px); }
                        75% { transform: translateX(10px); }
                    }
                `}</style>
            </div>
        </div>
    );
}
