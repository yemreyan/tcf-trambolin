/**
 * CompetitionsPage.jsx
 * Mevcut index.html — Yarışma seçimi ve yeni yarışma oluşturma
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { DataStore, Utils, Config } from '../lib/DataService';

export default function CompetitionsPage() {
    const navigate = useNavigate();
    const { verifyAdmin } = useAuth();
    const { toast, prompt } = useNotification();

    const [comps, setComps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    // Form
    const [newName, setNewName] = useState('');
    const [newLoc, setNewLoc] = useState('');
    const [newType, setNewType] = useState('OTHER');

    useEffect(() => {
        loadComps();
    }, []);

    async function loadComps() {
        setLoading(true);
        try {
            const all = await DataStore.getAllCompetitions();
            const active = all.filter(c => c && c.id && c.name && c.status !== 'archived');
            setComps(active);
        } catch (e) {
            toast('Yarışmalar yüklenemedi: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate() {
        let name = newName.trim();
        let loc = newLoc.trim();
        const type = newType;

        if (!name) {
            name = await prompt('Yarışma Adı:', 'Örn: Türkiye Şampiyonası');
            if (!name) return;
        }
        if (!loc) {
            loc = await prompt('Konum / Şehir:', 'İstanbul');
            if (!loc) return;
        }

        setCreating(true);
        try {
            let initialCategories = [];
            if (type && Config.DEFAULT_CATEGORIES[type]) {
                initialCategories = Config.DEFAULT_CATEGORIES[type].map(catName => ({
                    id: Utils.id('cat'),
                    name: catName,
                    athletes: []
                }));
            }

            const newComp = {
                id: Utils.id('comp'),
                name,
                location: loc,
                date: new Date().toISOString().split('T')[0],
                categories: initialCategories.length
                    ? Object.fromEntries(initialCategories.map(c => [c.id, c]))
                    : {},
                status: 'active'
            };

            await DataStore.saveCompetition(newComp);
            toast(
                `Yarışma oluşturuldu.${initialCategories.length ? ` ${initialCategories.length} kategori eklendi.` : ''}`,
                'success'
            );

            setNewName(''); setNewLoc(''); setNewType('OTHER');
            await loadComps();

            // Hemen bu yarışmaya gir
            await openComp(newComp.id);
        } catch (e) {
            toast('Oluşturma hatası: ' + e.message, 'error');
        } finally {
            setCreating(false);
        }
    }

    async function openComp(id) {
        const comp = comps.find(c => c.id === id) || (await DataStore.getCompetition(id));
        const compName = comp?.name || id;

        const input = await prompt(`"${compName}" için Admin Şifresi:`, '', '', 'password');
        if (input === null) return; // İptal

        const ok = await verifyAdmin(id, input);
        if (ok) {
            navigate('/panel');
        } else {
            toast('Hatalı şifre!', 'error');
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* Nav */}
            <nav className="topnav">
                <div>
                    <div className="brand-title">TCF</div>
                    <div className="brand-subtitle">TRAMBOLİN YÖNETİM SİSTEMİ</div>
                </div>
                <a href="/admin-tools" style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
                    <i className="material-icons-round" style={{ fontSize: '1.1rem' }}>build</i>
                    Admin Tools
                </a>
            </nav>

            {/* Content */}
            <div className="container" style={{ maxWidth: 900 }}>
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title">Yarışma Seçimi</h2>
                        <small className="text-muted">Lütfen yönetmek istediğiniz yarışmayı seçiniz</small>
                    </div>
                    <div className="card-body">
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 30 }}>

                            {/* Yarışma Listesi */}
                            <div>
                                <h4 style={{ color: '#94a3b8', marginBottom: 15, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                                    Mevcut Yarışmalar
                                </h4>

                                {loading && (
                                    <div className="text-muted" style={{ padding: 20 }}>Yükleniyor...</div>
                                )}

                                {!loading && comps.length === 0 && (
                                    <div className="text-muted" style={{
                                        padding: 24, background: 'rgba(255,255,255,0.03)',
                                        borderRadius: 12, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)'
                                    }}>
                                        Henüz yarışma bulunmamaktadır.
                                    </div>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {comps.map(c => (
                                        <CompItem key={c.id} comp={c} onClick={() => openComp(c.id)} />
                                    ))}
                                </div>
                            </div>

                            {/* Yeni Oluştur */}
                            <div style={{ borderLeft: '1px dashed rgba(255,255,255,0.1)', paddingLeft: 30 }}>
                                <h4 style={{ color: '#94a3b8', marginBottom: 15, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                                    Yeni Oluştur
                                </h4>

                                <div className="form-group">
                                    <label>Yarışma Adı</label>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={e => setNewName(e.target.value)}
                                        placeholder="Örn: Kulüpler Şampiyonası 2025"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Konum</label>
                                    <input
                                        type="text"
                                        value={newLoc}
                                        onChange={e => setNewLoc(e.target.value)}
                                        placeholder="Şehir"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Yarışma Tipi</label>
                                    <select value={newType} onChange={e => setNewType(e.target.value)}>
                                        <option value="OTHER">Diğer (Boş)</option>
                                        <option value="YAS_GRUPLARI">Yaş Grupları</option>
                                        <option value="KULUPLER">Kulüplerarası</option>
                                    </select>
                                </div>

                                <button
                                    className="btn btn-primary w-100"
                                    onClick={handleCreate}
                                    disabled={creating}
                                >
                                    <i className="material-icons-round">add_circle</i>
                                    {creating ? 'OLUŞTURULUYOR...' : 'OLUŞTUR'}
                                </button>
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CompItem({ comp, onClick }) {
    const [hover, setHover] = useState(false);
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                padding: 16,
                border: '1px solid',
                borderColor: hover ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)',
                borderRadius: 12,
                cursor: 'pointer',
                background: hover ? 'rgba(56,189,248,0.04)' : 'transparent',
                transition: 'all 0.2s',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: 'white' }}>{comp.name || 'İsimsiz Yarışma'}</strong>
                <i className="material-icons-round" style={{ color: '#94a3b8', fontSize: '1rem' }}>arrow_forward_ios</i>
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                <i className="material-icons-round" style={{ fontSize: 13 }}>place</i>
                {comp.location || 'Konum belirtilmemiş'}
                {comp.date && <span style={{ marginLeft: 8 }}>· {comp.date}</span>}
            </div>
        </div>
    );
}
