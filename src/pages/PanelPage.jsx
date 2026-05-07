/**
 * PanelPage.jsx
 * Mevcut panel.html — Yarışma yönetim ana menüsü
 * Jüri grubu seçimi → hakem ekranı açma dahil
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { DataStore } from '../lib/DataService';

export default function PanelPage() {
    const navigate = useNavigate();
    const { getActiveCompId, clearActiveComp } = useAuth();
    const { toast } = useNotification();

    const [comp, setComp] = useState(null);
    const [juryPanels, setJuryPanels] = useState({});
    const [judgeModal, setJudgeModal] = useState(false);
    const [selectedPanelId, setSelectedPanelId] = useState(null);
    const [step, setStep] = useState('groups'); // 'groups' | 'roles'

    const compId = getActiveCompId();

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        loadData();
    }, [compId]);

    async function loadData() {
        try {
            const c = await DataStore.getCompetition(compId);
            if (!c) { navigate('/'); return; }
            setComp(c);

            const snap = await get(ref(db, `competitions/${compId}/juryPanels`));
            setJuryPanels(snap.val() || {});
        } catch (e) {
            toast('Yükleme hatası: ' + e.message, 'error');
        }
    }

    function openJudge(role, id) {
        if (!selectedPanelId) { toast('Lütfen önce jüri grubu seçin.', 'warning'); return; }
        const url = `/judge-cockpit?role=${role}&id=${id}&panel=${selectedPanelId}&comp=${compId}`;
        window.open(url, '_blank');
    }

    function openCJP() {
        if (!selectedPanelId) { toast('Lütfen önce jüri grubu seçin.', 'warning'); return; }
        window.open(`/cjp?panel=${selectedPanelId}&comp=${compId}`, '_blank');
    }

    function selectJuryGroup(id) {
        setSelectedPanelId(id);
        setStep('roles');
    }

    const panelIds = Object.keys(juryPanels);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* Nav */}
            <nav className="topnav">
                <div>
                    <div className="brand-title">TCF</div>
                    <div className="brand-subtitle">YÖNETİM MOTORU</div>
                </div>
                <button
                    className="btn btn-outline btn-sm"
                    onClick={() => { clearActiveComp(); navigate('/'); }}
                    style={{ color: 'white', borderColor: 'rgba(255,255,255,0.4)' }}
                >
                    <i className="material-icons-round">swap_horiz</i> Yarışma Değiştir
                </button>
            </nav>

            <div className="container">
                {/* Header */}
                <div className="header-summary">
                    <div>
                        <small className="text-muted">AKTİF YARIŞMA</small>
                        <h2 style={{ color: 'var(--accent-primary)', marginTop: 4 }}>
                            {comp ? comp.name : 'Yükleniyor...'}
                        </h2>
                    </div>
                    <div className="badge active" style={{ fontSize: '1rem', padding: '8px 16px' }}>ONLINE</div>
                </div>

                {/* Menu Grid */}
                <div className="menu-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 24 }}>
                    <MenuCard icon="category" title="Kategoriler" desc="Yaş grupları ve alet tanımları" onClick={() => navigate('/categories')} />
                    <MenuCard icon="person_add" title="Kayıt İşlemleri" desc="Sporcu ekle/düzenle/sil" onClick={() => navigate('/registration')} />
                    <MenuCard icon="format_list_numbered" title="Start Listesi" desc="Çıkış sırasını düzenle" onClick={() => navigate('/start-list')} />
                    <MenuCard icon="gavel" title="Hakem Paneli" desc="E/D Hakem Ekranlarını Aç" onClick={() => { setStep('groups'); setSelectedPanelId(null); setJudgeModal(true); }} />

                    <MenuCard
                        icon="stars" title="Başhakem (CJP)" desc="Sporcu Çağır / T-H-S Girişi"
                        onClick={() => {
                            // Panel seçilmeden CJP açılamaz — hakem modal üzerinden açılmalı
                            if (panelIds.length === 1) {
                                // Tek panel varsa direkt aç
                                window.open(`/cjp?panel=${panelIds[0]}&comp=${compId}`, '_blank');
                            } else {
                                // Çoklu / sıfır panel → modal ile seç
                                setStep('groups');
                                setSelectedPanelId(null);
                                setJudgeModal(true);
                            }
                        }}
                        accentColor="var(--accent-primary)"
                    />

                    <MenuCard icon="people" title="Jüri Yönetimi" desc="Hakem İsimlerini Ata" onClick={() => navigate('/jury')} />
                    <MenuCard icon="tv" title="Skorboard" desc="Seyirci ekranı (Projeksiyon)" onClick={() => window.open(`/scoreboard?comp=${compId}`, '_blank')} />

                    <MenuCard
                        icon="monitor_heart" title="Canlı Sonuçlar" desc="TV Ekranı (Salondaki TV)"
                        onClick={() => window.open(`/results/live?comp=${compId}`, '_blank')}
                        accentColor="#1e293b"
                    />

                    <MenuCard icon="print" title="Final Sonuçlar" desc="Çıktı & Excel Listeleri" onClick={() => window.open(`/results/final?id=${compId}`, '_blank')} />

                    <MenuCard
                        icon="emoji_events" title="Final Oluştur" desc="Sıralama ve Final Grubu"
                        onClick={() => navigate('/create-finals')}
                        accentColor="#10b981"
                    />

                    <MenuCard
                        icon="vpn_key" title="Şifre Yönetimi" desc="Hakem şifrelerini yönet"
                        onClick={() => navigate('/password-admin')}
                        accentColor="#f43f5e"
                    />
                </div>
            </div>

            {/* Hakem Modal */}
            {judgeModal && (
                <div
                    onClick={(e) => e.target === e.currentTarget && setJudgeModal(false)}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backdropFilter: 'blur(4px)',
                    }}
                >
                    <div className="card" style={{ width: 500, maxHeight: '80vh', overflowY: 'auto' }}>
                        <div className="card-header">
                            <h3 className="card-title">Hakem Ekranı Seçiniz</h3>
                        </div>
                        <div className="card-body">

                            {/* Step 1: Jüri Grubu */}
                            {step === 'groups' && (
                                <div>
                                    <h4 style={{ color: '#94a3b8', marginBottom: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <i className="material-icons-round">groups</i> JÜRİ GRUBU SEÇİN
                                    </h4>

                                    {panelIds.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
                                            <i className="material-icons-round" style={{ fontSize: 48, opacity: 0.3, display: 'block', marginBottom: 10 }}>groups</i>
                                            Henüz jüri grubu tanımlanmamış.
                                            <button className="btn btn-primary btn-sm" style={{ marginTop: 12, display: 'block', margin: '12px auto 0' }}
                                                onClick={() => { setJudgeModal(false); navigate('/jury'); }}>
                                                Jüri Yönetimine Git
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            {panelIds.map(id => {
                                                const p = juryPanels[id];
                                                const memberCount = p.members ? Object.keys(p.members).length : 0;
                                                return (
                                                    <button
                                                        key={id}
                                                        className="btn btn-outline w-100"
                                                        onClick={() => selectJuryGroup(id)}
                                                        style={{ justifyContent: 'space-between', padding: '15px 20px' }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                            <i className="material-icons-round" style={{ color: 'var(--accent-secondary)' }}>groups</i>
                                                            <div style={{ textAlign: 'left' }}>
                                                                <div style={{ fontWeight: 700 }}>{p.name || id}</div>
                                                                <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{memberCount} hakem tanımlı</div>
                                                            </div>
                                                        </div>
                                                        <i className="material-icons-round">arrow_forward_ios</i>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Step 2: Rol Seçimi */}
                            {step === 'roles' && (
                                <div>
                                    <button className="btn btn-outline btn-sm" style={{ marginBottom: 15 }}
                                        onClick={() => setStep('groups')}>
                                        <i className="material-icons-round">arrow_back</i> Geri
                                    </button>
                                    <h4 style={{ color: 'var(--accent-secondary)', marginBottom: 15 }}>
                                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8 }}>groups</i>
                                        {juryPanels[selectedPanelId]?.name || selectedPanelId}
                                    </h4>

                                    <h5 style={{ color: '#94a3b8', marginBottom: 10, fontSize: '0.8rem', letterSpacing: 1 }}>İCRA HAKEMLERİ (E)</h5>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                                        {['1','2','3','4','5','6'].map(n => (
                                            <button key={n} className="btn btn-outline" onClick={() => openJudge('judge-e', n)}>E{n}</button>
                                        ))}
                                    </div>

                                    <h5 style={{ color: '#94a3b8', marginBottom: 10, fontSize: '0.8rem', letterSpacing: 1 }}>ZORLUK HAKEMİ (D)</h5>
                                    <button className="btn btn-primary w-100" style={{ marginBottom: 20 }} onClick={() => openJudge('judge-d', '1')}>
                                        <i className="material-icons-round">speed</i> D - HAKEM (ZORLUK)
                                    </button>

                                    <h5 style={{ color: '#94a3b8', marginBottom: 10, fontSize: '0.8rem', letterSpacing: 1 }}>BAŞHAKEM (CJP)</h5>
                                    <button
                                        className="btn w-100"
                                        style={{ background: 'linear-gradient(135deg, #f43f5e, #be123c)', color: 'white', marginBottom: 10 }}
                                        onClick={openCJP}
                                    >
                                        <i className="material-icons-round">stars</i> BAŞHAKEM PANELİ
                                    </button>

                                    <h5 style={{ color: '#94a3b8', marginBottom: 10, fontSize: '0.8rem', letterSpacing: 1 }}>SKORBOARD</h5>
                                    <button
                                        className="btn btn-outline w-100"
                                        style={{ marginBottom: 20 }}
                                        onClick={() => window.open(`/scoreboard?panel=${selectedPanelId}&comp=${compId}`, '_blank')}
                                    >
                                        <i className="material-icons-round">tv</i> SKORBOARD — Panel {juryPanels[selectedPanelId]?.name || selectedPanelId}
                                    </button>
                                </div>
                            )}

                            <button className="btn btn-warning w-100" onClick={() => setJudgeModal(false)}>KAPAT</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function MenuCard({ icon, title, desc, onClick, accentColor }) {
    const [hover, setHover] = useState(false);
    const iconBg = accentColor
        ? `${accentColor}22`
        : 'rgba(56,189,248,0.1)';
    const iconColor = accentColor || 'var(--accent-secondary)';

    return (
        <div
            className="menu-card"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                borderColor: hover ? (accentColor || 'var(--accent-secondary)') : 'rgba(255,255,255,0.08)',
                cursor: 'pointer',
            }}
        >
            <div className="menu-icon" style={{ background: iconBg }}>
                <i className="material-icons-round" style={{ color: iconColor }}>{icon}</i>
            </div>
            <div className="menu-title">{title}</div>
            <div className="menu-desc">{desc}</div>
        </div>
    );
}
