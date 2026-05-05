/**
 * CategoriesPage.jsx
 * Mevcut categories.html — Kategori listesi, ekleme ve silme
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { Utils } from '../lib/DataService';

const LABELS = {
    male: 'Erkek', female: 'Kadın', mixed: 'Karma',
    individual: 'Bireysel', sync: 'Senkronize', dmt: 'DMT', tumbling: 'Tumbling',
    minik_a: 'Minik A (8-9)', minik_b: 'Minik B (10-12)',
    kucuk: 'Küçükler (13-14)', yildiz: 'Yıldızlar (15-16)',
    genc: 'Gençler (17-21)', buyuk: 'Büyükler (17+)',
};

const DEFAULT_FORM = {
    name: '',
    gender: 'male',
    type: 'individual',
    ageGroup: 'minik_b',
    ruleset: 'fig_2025',
};

export default function CategoriesPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm } = useNotification();

    const [categories, setCategories] = useState({});
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(DEFAULT_FORM);

    const compId = getActiveCompId();

    useEffect(() => {
        if (!compId) { navigate('/'); return; }

        const unsub = onValue(ref(db, `competitions/${compId}/categories`), snap => {
            setCategories(snap.val() || {});
        });
        return () => unsub();
    }, [compId]);

    // Otomatik isim oluştur
    function genName(f = form) {
        const age = LABELS[f.ageGroup] || f.ageGroup;
        const gender = LABELS[f.gender] || f.gender;
        const type = LABELS[f.type] || f.type;
        return `${age} ${gender} ${type}`;
    }

    function updateForm(key, val) {
        setForm(prev => {
            const next = { ...prev, [key]: val };
            // İsmi otomatik güncelle (sadece kullanıcı elle değiştirmediyse)
            next.name = genName(next);
            return next;
        });
    }

    function openModal() {
        const fresh = { ...DEFAULT_FORM };
        fresh.name = genName(fresh);
        setForm(fresh);
        setShowModal(true);
    }

    async function saveCat() {
        if (!form.name) return;
        const id = Utils.id('cat');
        await set(ref(db, `competitions/${compId}/categories/${id}`), {
            id,
            name: form.name,
            gender: form.gender,
            type: form.type,
            ageGroup: form.ageGroup,
            ruleset: form.ruleset,
            createdAt: Date.now(),
        });
        toast('Kategori eklendi.', 'success');
        setShowModal(false);
    }

    async function delCat(id) {
        const ok = await confirm('Kategoriyi Sil', 'Bu kategoriyi silmek istediğinize emin misiniz?');
        if (!ok) return;
        await remove(ref(db, `competitions/${compId}/categories/${id}`));
        toast('Kategori silindi.', 'info');
    }

    const catList = Object.values(categories);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* Nav */}
            <nav className="topnav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }} onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1 }}>KATEGORİ YÖNETİMİ</span>
                </div>
            </nav>

            <div className="container">
                <div className="card">
                    <div className="card-header flex-between">
                        <div>
                            <h3 className="card-title">Kategori Listesi</h3>
                            <div className="text-muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>Yarışma gruplarını tanımlayınız</div>
                        </div>
                        <button className="btn btn-primary" onClick={openModal}>
                            <i className="material-icons-round">add</i> YENİ EKLE
                        </button>
                    </div>

                    <div className="card-body">
                        <div className="table-responsive">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Kategori Adı</th>
                                        <th>Cinsiyet</th>
                                        <th>Yaş Grubu</th>
                                        <th>Tür</th>
                                        <th>İşlem</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {catList.length === 0 && (
                                        <tr><td colSpan={5} className="text-center text-muted" style={{ padding: 24 }}>Kategori Yok</td></tr>
                                    )}
                                    {catList.map(c => (
                                        <tr key={c.id}>
                                            <td>
                                                <div style={{ fontWeight: 700 }}>{c.name}</div>
                                                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
                                                    {LABELS[c.ageGroup] || c.ageGroup} / {LABELS[c.type] || c.type}
                                                </div>
                                            </td>
                                            <td>{LABELS[c.gender] || c.gender}</td>
                                            <td>{LABELS[c.ageGroup] || c.ageGroup}</td>
                                            <td>{LABELS[c.type] || c.type}</td>
                                            <td>
                                                <button
                                                    className="btn btn-sm btn-outline"
                                                    style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                                    onClick={() => delCat(c.id)}
                                                >
                                                    <i className="material-icons-round">delete</i>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Add Modal */}
            {showModal && (
                <div
                    onClick={e => e.target === e.currentTarget && setShowModal(false)}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backdropFilter: 'blur(4px)',
                    }}
                >
                    <div className="card" style={{ width: 520, maxWidth: '90%' }}>
                        <div className="card-header">
                            <h3 className="card-title">Yeni Kategori Oluştur</h3>
                        </div>
                        <div className="card-body">
                            <div className="form-group">
                                <label>Kategori İsmi</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Örn: Genç Erkekler Bireysel"
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                                <div className="form-group">
                                    <label>Cinsiyet</label>
                                    <select value={form.gender} onChange={e => updateForm('gender', e.target.value)}>
                                        <option value="male">Erkek</option>
                                        <option value="female">Kadın</option>
                                        <option value="mixed">Karma (Senk. İçin)</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Yarışma Türü</label>
                                    <select value={form.type} onChange={e => updateForm('type', e.target.value)}>
                                        <option value="individual">Bireysel (Trampolin)</option>
                                        <option value="sync">Senkronize</option>
                                        <option value="dmt">Double Mini</option>
                                        <option value="tumbling">Tumbling</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                                <div className="form-group">
                                    <label>Yaş Grubu</label>
                                    <select value={form.ageGroup} onChange={e => updateForm('ageGroup', e.target.value)}>
                                        <option value="minik_a">Minik A (8-9 Yaş)</option>
                                        <option value="minik_b">Minik B (10-12 Yaş)</option>
                                        <option value="kucuk">Küçükler (13-14 Yaş)</option>
                                        <option value="yildiz">Yıldızlar (15-16 Yaş)</option>
                                        <option value="genc">Gençler (17-21 Yaş)</option>
                                        <option value="buyuk">Büyükler (17+)</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Kural Seti</label>
                                    <select value={form.ruleset} onChange={e => setForm(prev => ({ ...prev, ruleset: e.target.value }))}>
                                        <option value="fig_2025">TCF / FIG 2025-2028</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{
                                background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)',
                                borderRadius: 8, padding: 12, fontSize: '0.82rem', color: '#94a3b8', marginBottom: 20,
                            }}>
                                <i className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 6 }}>info</i>
                                Seçilen kural setine göre hakem paneli ve kesinti kuralları otomatik ayarlanacaktır.
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <button className="btn btn-outline" onClick={() => setShowModal(false)}>İPTAL</button>
                                <button className="btn btn-primary" onClick={saveCat}>OLUŞTUR</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
