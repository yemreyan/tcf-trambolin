/**
 * PasswordAdminPage.jsx
 * Mevcut password_admin.html — Admin şifre yönetimi.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}/passwords/admin
 *   competitions/{compId}/passwords/panels/{panelId}/{role}
 *   competitions/{compId}/juryPanels
 *
 * Super admin fallback password: 63352180
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';

const ROLES = [
    { id: 'cjp', name: 'Başhakem (CJP)', icon: 'stars', color: '#f43f5e' },
    { id: 'd',   name: 'Zorluk Hakemi (D)', icon: 'speed', color: '#fbbf24' },
    { id: 'e1',  name: 'İcra Hakemi E1', icon: 'person', color: '#3b82f6' },
    { id: 'e2',  name: 'İcra Hakemi E2', icon: 'person', color: '#3b82f6' },
    { id: 'e3',  name: 'İcra Hakemi E3', icon: 'person', color: '#3b82f6' },
    { id: 'e4',  name: 'İcra Hakemi E4', icon: 'person', color: '#3b82f6' },
    { id: 'e5',  name: 'İcra Hakemi E5', icon: 'person', color: '#3b82f6' },
    { id: 'e6',  name: 'İcra Hakemi E6', icon: 'person', color: '#3b82f6' },
];

function randPass(length = 6) {
    const chars = '0123456789';
    let s = '';
    for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

export default function PasswordAdminPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast } = useNotification();

    const compId = getActiveCompId();

    const [unlocked, setUnlocked] = useState(false);
    const [adminInput, setAdminInput] = useState('');
    const [adminErr, setAdminErr] = useState(false);
    const [loggingIn, setLoggingIn] = useState(false);

    const [adminPass, setAdminPass] = useState('admin');
    const [juryPanels, setJuryPanels] = useState({});
    // panelPasswords: { [panelId]: { [role]: value } }
    const [panelPasswords, setPanelPasswords] = useState({});

    useEffect(() => {
        if (!compId) { toast('Yarışma seçilmemiş!', 'error'); navigate('/'); return; }
    }, [compId]);

    async function handleAdminLogin() {
        if (!adminInput.trim()) return;
        setLoggingIn(true); setAdminErr(false);
        try {
            const snap = await get(ref(db, `competitions/${compId}/passwords/admin`));
            const stored = snap.exists() ? snap.val() : 'admin';
            if (adminInput === stored || adminInput === '63352180') {
                setUnlocked(true);
                await loadData();
            } else {
                setAdminErr(true);
                setAdminInput('');
                setTimeout(() => setAdminErr(false), 3000);
            }
        } finally {
            setLoggingIn(false);
        }
    }

    async function loadData() {
        const [panelsSnap, passSnap] = await Promise.all([
            get(ref(db, `competitions/${compId}/juryPanels`)),
            get(ref(db, `competitions/${compId}/passwords`)),
        ]);
        setJuryPanels(panelsSnap.val() || {});
        const passwords = passSnap.val() || {};
        setAdminPass(passwords.admin || 'admin');
        setPanelPasswords(passwords.panels || {});
    }

    function setPanelVal(panelId, role, val) {
        setPanelPasswords(prev => ({
            ...prev,
            [panelId]: { ...(prev[panelId] || {}), [role]: val },
        }));
    }

    function generateOne(panelId, role) {
        setPanelVal(panelId, role, randPass());
    }

    function generateAllForPanel(panelId) {
        setPanelPasswords(prev => {
            const next = { ...prev, [panelId]: { ...(prev[panelId] || {}) } };
            ROLES.forEach(r => { next[panelId][r.id] = randPass(); });
            return next;
        });
        toast('Tüm şifreler oluşturuldu', 'success');
    }

    async function copyValue(val) {
        if (!val) { toast('Şifre boş', 'warning'); return; }
        try {
            await navigator.clipboard.writeText(val);
            toast('Şifre kopyalandı', 'success');
        } catch {
            toast('Kopyalanamadı', 'error');
        }
    }

    async function saveAll() {
        try {
            const updates = {};
            if (adminPass.trim()) {
                updates[`competitions/${compId}/passwords/admin`] = adminPass.trim();
            }
            Object.entries(panelPasswords).forEach(([panelId, roles]) => {
                Object.entries(roles || {}).forEach(([role, value]) => {
                    if (value && String(value).trim()) {
                        updates[`competitions/${compId}/passwords/panels/${panelId}/${role}`] = String(value).trim();
                    }
                });
            });
            await update(ref(db), updates);
            toast('Tüm şifreler kaydedildi!', 'success');
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        }
    }

    // ── Admin kapısı ──────────────────────────────────────────────────────
    if (!unlocked) {
        return (
            <div style={{
                position: 'fixed', inset: 0,
                background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
                <div style={{
                    background: 'rgba(30,41,59,0.4)', backdropFilter: 'blur(25px)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 30,
                    padding: 50, textAlign: 'center', maxWidth: 450, width: '100%',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                }}>
                    <div style={{
                        width: 80, height: 80,
                        background: 'linear-gradient(135deg,#f43f5e 0%,#be123c 100%)',
                        borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 25px', boxShadow: '0 0 40px rgba(244,63,94,0.3)',
                    }}>
                        <i className="material-icons-round" style={{ fontSize: 40, color: 'white' }}>admin_panel_settings</i>
                    </div>
                    <h2 style={{ color: 'white', marginBottom: 10 }}>Admin Girişi</h2>
                    <p style={{ color: '#94a3b8', marginBottom: 30, fontSize: '0.9rem' }}>
                        Şifre yönetimine erişmek için admin şifresini giriniz
                    </p>
                    <input
                        type="password"
                        value={adminInput}
                        onChange={e => setAdminInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
                        placeholder="Admin Şifresi"
                        autoFocus
                        style={{
                            width: '100%', padding: '16px 20px', fontSize: '1rem',
                            background: 'rgba(0,0,0,0.3)',
                            border: `2px solid ${adminErr ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                            borderRadius: 12, color: 'white', textAlign: 'center',
                            marginBottom: 20, boxSizing: 'border-box',
                        }}
                    />
                    <button
                        onClick={handleAdminLogin}
                        disabled={loggingIn}
                        style={{
                            width: '100%', padding: 14,
                            background: 'linear-gradient(135deg,#10b981 0%,#059669 100%)',
                            color: 'white', border: 'none', borderRadius: 12,
                            fontWeight: 700, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                            boxShadow: '0 4px 15px rgba(16,185,129,0.3)',
                        }}>
                        <i className="material-icons-round">{loggingIn ? 'hourglass_empty' : 'login'}</i>
                        {loggingIn ? 'KONTROL...' : 'GİRİŞ'}
                    </button>
                    {adminErr && <p style={{ color: '#ef4444', marginTop: 15 }}>Yanlış şifre!</p>}
                    <p style={{ color: '#64748b', marginTop: 20, fontSize: '0.8rem' }}>
                        İlk kullanımda admin şifresi: <strong>admin</strong>
                    </p>
                </div>
            </div>
        );
    }

    // ── Main Content ──────────────────────────────────────────────────────
    const panelIds = Object.keys(juryPanels);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'radial-gradient(circle at top right, #1e1b4b 0%, #0f172a 40%, #020617 100%)',
            color: 'white', fontFamily: "'Outfit', sans-serif",
        }}>
            <nav className="topnav">
                <div className="brand">
                    <div className="brand-title">TCF</div>
                    <div className="brand-subtitle">ŞİFRE YÖNETİMİ</div>
                </div>
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                    onClick={() => navigate('/panel')}>
                    <i className="material-icons-round">arrow_back</i> Panel
                </button>
            </nav>

            <div style={{ maxWidth: 1600, margin: '0 auto', padding: 30 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 }}>
                    <h1 style={{ margin: 0, fontSize: '1.8rem' }}>
                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 10 }}>vpn_key</i>
                        Şifre Yönetimi
                    </h1>
                    <button onClick={saveAll} style={{
                        background: 'linear-gradient(135deg,#10b981 0%,#059669 100%)',
                        color: 'white', padding: '14px 28px', border: 'none', borderRadius: 12,
                        fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                        fontSize: '1rem', boxShadow: '0 4px 15px rgba(16,185,129,0.3)',
                    }}>
                        <i className="material-icons-round">save</i> TÜMÜNÜ KAYDET
                    </button>
                </div>

                {/* Admin Password Section */}
                <PanelCard title="Admin Şifresi" icon="admin_panel_settings" iconColor="#f43f5e">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                        <PasswordField
                            label="Admin"
                            labelIcon="security"
                            value={adminPass}
                            onChange={setAdminPass}
                            onCopy={() => copyValue(adminPass)}
                            onGenerate={() => setAdminPass(randPass())}
                        />
                    </div>
                </PanelCard>

                {/* Panel Passwords */}
                {panelIds.length === 0 ? (
                    <div style={{
                        textAlign: 'center', padding: '80px 20px', color: '#94a3b8',
                        background: 'rgba(15,23,42,0.6)', borderRadius: 24,
                        border: '1px solid rgba(255,255,255,0.05)',
                    }}>
                        <i className="material-icons-round" style={{ fontSize: 72, opacity: 0.5, color: '#64748b' }}>groups_off</i>
                        <p>Bu yarışmada jüri grubu tanımlanmamış.</p>
                        <p style={{ fontSize: '0.85rem', marginTop: 10 }}>Jüri Yönetimi sayfasından grup oluşturun.</p>
                    </div>
                ) : (
                    panelIds.map(panelId => {
                        const panel = juryPanels[panelId];
                        const pPasswords = panelPasswords[panelId] || {};
                        return (
                            <PanelCard
                                key={panelId}
                                title={panel.name || panelId}
                                icon="groups"
                                iconColor="#3b82f6"
                                extra={
                                    <button onClick={() => generateAllForPanel(panelId)} style={{
                                        background: 'rgba(168,85,247,0.1)', color: '#a855f7',
                                        padding: '10px 20px', border: '1px solid rgba(168,85,247,0.2)',
                                        borderRadius: 10, fontWeight: 600, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem',
                                    }}>
                                        <i className="material-icons-round">auto_fix_high</i> Tümünü Oluştur
                                    </button>
                                }
                            >
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                                    {ROLES.map(role => (
                                        <PasswordField
                                            key={role.id}
                                            label={role.name}
                                            labelIcon={role.icon}
                                            labelColor={role.color}
                                            value={pPasswords[role.id] || ''}
                                            onChange={val => setPanelVal(panelId, role.id, val)}
                                            onCopy={() => copyValue(pPasswords[role.id] || '')}
                                            onGenerate={() => generateOne(panelId, role.id)}
                                        />
                                    ))}
                                </div>
                            </PanelCard>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// ── Alt bileşenler ────────────────────────────────────────────────────────
function PanelCard({ title, icon, iconColor, extra, children }) {
    return (
        <div style={{
            background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24,
            padding: 30, marginBottom: 30,
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
        }}>
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 25, paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 15, fontSize: '1.5rem', fontWeight: 700 }}>
                    <i className="material-icons-round" style={{ color: iconColor }}>{icon}</i>
                    {title}
                </div>
                {extra}
            </div>
            {children}
        </div>
    );
}

function PasswordField({ label, labelIcon, labelColor = '#94a3b8', value, onChange, onCopy, onGenerate }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 16, padding: 20,
        }}>
            <div style={{
                fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase',
                letterSpacing: 1.5, fontWeight: 600, marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
                <i className="material-icons-round" style={{ fontSize: 16, color: labelColor }}>{labelIcon}</i>
                {label}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    style={{
                        flex: 1, background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                        padding: '12px 16px', color: '#38bdf8',
                        fontFamily: "'Courier New', monospace",
                        fontSize: '1.1rem', letterSpacing: 3, fontWeight: 700,
                        outline: 'none',
                    }}
                />
                <IconBtn onClick={onCopy} title="Kopyala" color="#3b82f6"><i className="material-icons-round">content_copy</i></IconBtn>
                <IconBtn onClick={onGenerate} title="Rastgele Oluştur" color="#a855f7"><i className="material-icons-round">casino</i></IconBtn>
            </div>
        </div>
    );
}

function IconBtn({ onClick, title, color, children }) {
    return (
        <button onClick={onClick} title={title} style={{
            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${color}33`, borderRadius: 10, cursor: 'pointer',
            background: `${color}1A`, color,
        }}>
            {children}
        </button>
    );
}
