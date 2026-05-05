/**
 * AdminToolsPage.jsx
 * Mevcut admin_tools.html — Yarışma yönetimi, arşivleme,
 * klonlama, silme, kategori ID normalizasyonu.
 *
 * Firebase yolları aynen korundu:
 *   competitions
 *   competitions/{id}
 *   live/{id}
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, update, remove, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { useNotification } from '../lib/NotificationContext';
import { Utils, standardizeId } from '../lib/DataService';

export default function AdminToolsPage() {
    const navigate = useNavigate();
    const { toast, confirm, prompt } = useNotification();

    const [competitions, setCompetitions] = useState([]);
    const [filter, setFilter] = useState('all'); // all | active | archived
    const [catModalCompId, setCatModalCompId] = useState(null);

    useEffect(() => { load(); }, []);

    async function load() {
        const snap = await get(ref(db, 'competitions'));
        if (!snap.exists()) { setCompetitions([]); return; }
        const arr = Object.values(snap.val()).filter(c => c && c.id);
        setCompetitions(arr);
    }

    const filtered = competitions.filter(c => {
        if (filter === 'all') return true;
        if (filter === 'archived') return c.status === 'archived';
        return c.status !== 'archived';
    });

    async function archiveComp(id) {
        await update(ref(db, `competitions/${id}`), { status: 'archived' });
        toast('Arşivlendi', 'info');
        load();
    }

    async function restoreComp(id) {
        await update(ref(db, `competitions/${id}`), { status: 'active' });
        toast('Geri yüklendi', 'success');
        load();
    }

    async function deleteComp(id, name) {
        const ok1 = await confirm('Yarışmayı Sil', `"${name}" tamamen silinecek. Sporcular, sonuçlar, her şey. Devam?`);
        if (!ok1) return;
        const ok2 = await confirm('EMİN MİSİNİZ?', 'Bu işlem GERİ ALINAMAZ. Son kez onayla.');
        if (!ok2) return;
        await Promise.all([
            remove(ref(db, `competitions/${id}`)),
            remove(ref(db, `live/${id}`)),
        ]);
        toast('Silindi', 'info');
        load();
    }

    async function cloneComp(id) {
        const name = await prompt('Yarışmayı Klonla', 'Yeni yarışma ismi:', '');
        if (!name) return;
        const snap = await get(ref(db, `competitions/${id}`));
        if (!snap.exists()) return;
        const old = snap.val();
        const newId = `comp_${Date.now()}`;
        const fresh = {
            ...old,
            id: newId,
            name,
            status: 'active',
            createdAt: Date.now(),
            results: null, // sonuçlar sıfır
        };
        await set(ref(db, `competitions/${newId}`), fresh);
        toast('Klonlandı', 'success');
        load();
    }

    // ── Kategori ID normalizasyonu ────────────────────────────────────────
    async function normalizeAllCategories(compId) {
        const snap = await get(ref(db, `competitions/${compId}`));
        if (!snap.exists()) return;
        const comp = snap.val();
        const categories = comp.categories || {};
        const athletes = comp.athletes || {};

        const idMap = {}; // oldId → newId
        const updates = {};

        for (const [oldId, cat] of Object.entries(categories)) {
            const newId = standardizeId(cat.name, 'cat');
            if (newId !== oldId) {
                idMap[oldId] = newId;
                updates[`competitions/${compId}/categories/${newId}`] = { ...cat, id: newId };
                updates[`competitions/${compId}/categories/${oldId}`] = null;
            }
        }

        // Sporcu referanslarını güncelle
        for (const [athId, ath] of Object.entries(athletes)) {
            const c = ath.category || ath.categoryId || ath.catId;
            if (c && idMap[c]) {
                updates[`competitions/${compId}/athletes/${athId}/category`] = idMap[c];
                updates[`competitions/${compId}/athletes/${athId}/categoryId`] = idMap[c];
                updates[`competitions/${compId}/athletes/${athId}/catId`] = idMap[c];
            }
        }

        if (Object.keys(idMap).length === 0) {
            toast('Tüm kategori ID\'leri zaten doğru', 'info');
            return;
        }

        const ok = await confirm('Normalizasyon', `${Object.keys(idMap).length} kategori ID'si değişecek. Devam?`);
        if (!ok) return;

        await update(ref(db), updates);
        toast('Kategoriler normalize edildi', 'success');
        setCatModalCompId(null);
        load();
    }

    // ── Modal: Kategori listesi ───────────────────────────────────────────
    const modalComp = catModalCompId ? competitions.find(c => c.id === catModalCompId) : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav">
                <div className="brand">
                    <div className="brand-title">TCF</div>
                    <div className="brand-subtitle">ADMIN ARAÇLARI</div>
                </div>
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                    onClick={() => navigate('/')}>
                    <i className="material-icons-round">home</i> Ana Sayfa
                </button>
            </nav>

            <div className="container">
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {['all', 'active', 'archived'].map(f => (
                        <button
                            key={f}
                            className={'btn btn-sm ' + (filter === f ? 'btn-primary' : 'btn-outline')}
                            onClick={() => setFilter(f)}>
                            {f === 'all' ? 'TÜMÜ' : f === 'active' ? 'AKTİF' : 'ARŞİV'}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
                    {filtered.length === 0 && (
                        <div className="text-center text-muted" style={{ padding: 40, gridColumn: '1/-1' }}>
                            Yarışma yok
                        </div>
                    )}
                    {filtered.map(c => {
                        const catCount = c.categories ? Object.keys(c.categories).length : 0;
                        const athCount = c.athletes ? Object.keys(c.athletes).length : 0;
                        const archived = c.status === 'archived';
                        return (
                            <div key={c.id} className="card" style={{
                                opacity: archived ? 0.7 : 1,
                                borderLeft: `4px solid ${archived ? '#64748b' : 'var(--accent-primary,#F43F5E)'}`,
                            }}>
                                <div className="card-body">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{c.name}</div>
                                            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: 4 }}>
                                                {c.location || ''} {c.date ? `— ${c.date}` : ''}
                                            </div>
                                        </div>
                                        {archived && (
                                            <span style={{
                                                padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700,
                                                background: 'rgba(100,116,139,0.2)', color: '#94a3b8', borderRadius: 4,
                                            }}>ARŞİV</span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: '0.85rem', color: '#cbd5e1' }}>
                                        <div><strong>{catCount}</strong> kategori</div>
                                        <div><strong>{athCount}</strong> sporcu</div>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                                        {archived ? (
                                            <button className="btn btn-sm btn-outline" onClick={() => restoreComp(c.id)}>
                                                <i className="material-icons-round">unarchive</i> Geri Yükle
                                            </button>
                                        ) : (
                                            <button className="btn btn-sm btn-outline" onClick={() => archiveComp(c.id)}>
                                                <i className="material-icons-round">archive</i> Arşivle
                                            </button>
                                        )}
                                        <button className="btn btn-sm btn-outline" onClick={() => cloneComp(c.id)}>
                                            <i className="material-icons-round">content_copy</i> Klonla
                                        </button>
                                        <button className="btn btn-sm btn-outline" onClick={() => setCatModalCompId(c.id)}>
                                            <i className="material-icons-round">category</i> Kategori
                                        </button>
                                        <button className="btn btn-sm btn-outline"
                                            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                            onClick={() => deleteComp(c.id, c.name)}>
                                            <i className="material-icons-round">delete</i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Kategori Modal */}
            {modalComp && (
                <div onClick={e => e.target === e.currentTarget && setCatModalCompId(null)} style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(4px)',
                }}>
                    <div className="card" style={{ width: 640, maxWidth: '90%', maxHeight: '85vh', overflow: 'auto' }}>
                        <div className="card-header flex-between">
                            <h3 className="card-title">{modalComp.name} — Kategoriler</h3>
                            <button className="btn btn-sm btn-outline" onClick={() => setCatModalCompId(null)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="card-body">
                            <div style={{ marginBottom: 12, fontSize: '0.85rem', color: '#94a3b8' }}>
                                ID uyumsuzlukları toplu olarak normalize edilebilir.
                            </div>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Ad</th>
                                        <th>Mevcut ID</th>
                                        <th>Normalize ID</th>
                                        <th style={{ textAlign: 'center' }}>Durum</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.values(modalComp.categories || {}).map(cat => {
                                        const norm = standardizeId(cat.name, 'cat');
                                        const match = norm === cat.id;
                                        return (
                                            <tr key={cat.id}>
                                                <td>{cat.name}</td>
                                                <td style={{ fontFamily: "'Space Mono',monospace", fontSize: '0.82rem' }}>{cat.id}</td>
                                                <td style={{ fontFamily: "'Space Mono',monospace", fontSize: '0.82rem', color: match ? 'inherit' : '#f59e0b' }}>
                                                    {norm}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {match ? (
                                                        <i className="material-icons-round" style={{ color: '#10b981' }}>check</i>
                                                    ) : (
                                                        <i className="material-icons-round" style={{ color: '#f59e0b' }}>warning</i>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }}
                                onClick={() => normalizeAllCategories(modalComp.id)}>
                                <i className="material-icons-round">auto_fix_high</i> Tümünü Normalize Et
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
