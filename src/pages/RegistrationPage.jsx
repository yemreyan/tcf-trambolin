/**
 * RegistrationPage.jsx
 * Mevcut registration.html — Sporcu kayıt, Excel import/export,
 * inline kategori düzenleme, toplu kategori atama.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}/athletes/{athId}
 *   competitions/{compId}/categories
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { DataService, DataStore, Utils } from '../lib/DataService';

export default function RegistrationPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm } = useNotification();

    const compId = getActiveCompId();
    const dsRef = useRef(null);

    const [categories, setCategories] = useState([]); // [{id,name}]
    const [athletes, setAthletes] = useState({});
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [editingCatId, setEditingCatId] = useState(null); // athlete id currently editing category inline
    const [bulkCatId, setBulkCatId] = useState('');

    const [form, setForm] = useState({
        name: '', surname: '', club: '', category: '', dob: '',
    });
    const [imgB64, setImgB64] = useState(null);

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        dsRef.current = new DataService(compId);

        // Kategorileri yükle
        (async () => {
            const comp = await DataStore.getCompetition(compId);
            if (!comp) return;
            const cats = comp.categories
                ? Object.values(comp.categories).map(c => ({ id: c.id, name: c.name }))
                : [{ id: 'cat_default', name: 'Genel Kategori' }];
            setCategories(cats);
        })();

        // Sporcuları canlı dinle
        const unsubA = onValue(ref(db, `competitions/${compId}/athletes`), snap => {
            setAthletes(snap.val() || {});
        });

        return () => { unsubA(); };
    }, [compId]);

    const athleteList = useMemo(() => Object.values(athletes), [athletes]);
    const catName = (catId) => categories.find(c => c.id === catId)?.name || null;

    // ── Foto önizleme (canvas ile yeniden boyutlandır) ────────────────────
    function onPhotoChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 300;
                let w = img.width, h = img.height;
                if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
                else { if (h > MAX) { w *= MAX / h; h = MAX; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                setImgB64(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── Sporcu ekle ───────────────────────────────────────────────────────
    async function handleAdd(e) {
        e.preventDefault();
        if (!form.name || !form.surname || !form.dob) {
            toast('Eksik bilgi (Ad, Soyad, Doğum Tarihi)', 'warning');
            return;
        }
        await dsRef.current.addAthlete({
            name: form.name.trim(),
            surname: form.surname.trim(),
            club: form.club.trim(),
            category: form.category,
            dob: form.dob,
            profilePic: imgB64,
        });
        setForm({ name: '', surname: '', club: '', category: form.category, dob: '' });
        setImgB64(null);
        toast('Sporcu eklendi.', 'success');
    }

    async function handleDelete(id) {
        const ok = await confirm('Sporcuyu Sil', 'Silmek istediğinize emin misiniz?');
        if (!ok) return;
        await dsRef.current.deleteAthlete(id);
        toast('Sporcu silindi.', 'info');
    }

    // ── Inline kategori değiştir ───────────────────────────────────────────
    async function saveInlineCat(athId, newCatId) {
        if (!newCatId) { setEditingCatId(null); return; }
        try {
            await update(ref(db, `competitions/${compId}/athletes/${athId}`), {
                category: newCatId, catId: newCatId, categoryId: newCatId,
            });
            setEditingCatId(null);
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        }
    }

    // ── Seçim & toplu uygula ──────────────────────────────────────────────
    function toggleSel(id) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    function toggleAll(checked) {
        setSelectedIds(checked ? new Set(athleteList.map(a => a.id)) : new Set());
    }

    function clearSel() {
        setSelectedIds(new Set());
    }

    async function applyBulkCategory() {
        if (!bulkCatId) { toast('Lütfen kategori seçin', 'warning'); return; }
        if (selectedIds.size === 0) return;
        const updates = {};
        selectedIds.forEach(id => {
            updates[`competitions/${compId}/athletes/${id}/category`] = bulkCatId;
            updates[`competitions/${compId}/athletes/${id}/catId`] = bulkCatId;
            updates[`competitions/${compId}/athletes/${id}/categoryId`] = bulkCatId;
        });
        try {
            await update(ref(db), updates);
            clearSel();
            toast('Kategori uygulandı.', 'success');
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        }
    }

    // ── Excel ────────────────────────────────────────────────────────────
    async function loadXLSX() {
        if (window.XLSX) return window.XLSX;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        return window.XLSX;
    }

    async function downloadTemplate() {
        const XLSX = await loadXLSX();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([["Ad", "Soyad", "Kulüp", "Kategori", "Doğum Tarihi (GG.AA.YYYY)", "Göğüs No"]]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sporcular');
        XLSX.writeFile(wb, 'Sporcu_Kayit_Sablon.xlsx');
    }

    async function importExcel(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const XLSX = await loadXLSX();
        const data = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(data, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        if (rows.length === 0) { toast('Dosya boş.', 'warning'); return; }

        const norm = (s) => String(s || '').toLowerCase()
            .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

        const catMap = {}, catMapOrig = {};
        categories.forEach(c => {
            catMap[norm(c.name)] = c.id;
            catMapOrig[c.name.toLowerCase().trim()] = c.id;
        });

        const findCatId = (raw) => {
            if (!raw) return '';
            const s = String(raw).trim();
            if (catMapOrig[s.toLowerCase()]) return catMapOrig[s.toLowerCase()];
            if (catMap[norm(s)]) return catMap[norm(s)];
            const ns = norm(s);
            for (const [key, id] of Object.entries(catMap)) {
                if (key.includes(ns) || ns.includes(key)) return id;
            }
            return s;
        };

        const unmatched = new Set();
        let added = 0;
        for (const row of rows) {
            const name = row['Ad'] || row['Name'];
            const surname = row['Soyad'] || row['Surname'];
            if (!name || !surname) continue;

            const cRaw = row['Kategori'] || row['Category'];
            const catId = findCatId(cRaw);
            if (cRaw && catId === String(cRaw).trim()) unmatched.add(String(cRaw).trim());

            let dob = row['Doğum Tarihi'] || row['Doğum Tarihi (GG.AA.YYYY)'] || '';
            if (typeof dob === 'number') {
                const d = new Date(Math.round((dob - 25569) * 86400 * 1000));
                dob = d.toISOString().split('T')[0];
            }

            const id = Utils.id('ath_xl');
            await set(ref(db, `competitions/${compId}/athletes/${id}`), {
                id,
                name: String(name).trim(),
                surname: String(surname).trim(),
                club: row['Kulüp'] || row['Club'] || '',
                category: catId,
                dob,
                bib: row['Göğüs No'] || '',
                regDate: Date.now(),
            });
            added++;
        }
        let msg = `${added} sporcu eklendi.`;
        if (unmatched.size > 0) {
            msg += ` ${unmatched.size} kategori eşleşmedi.`;
        }
        toast(msg, 'success');
        e.target.value = '';
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1 }}>SPORCU KAYIT</span>
                </div>
            </nav>

            <div className="container" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 30 }}>

                {/* ── FORM ─────────────────────────────────────────────── */}
                <div className="card" style={{ height: 'fit-content' }}>
                    <div className="card-header flex-between">
                        <h3 className="card-title">Yeni Sporcu Ekle</h3>
                        <div style={{ display: 'flex', gap: 5 }}>
                            <button className="btn btn-outline btn-sm" onClick={downloadTemplate} title="Excel Şablonu">
                                <i className="material-icons-round">download</i>
                            </button>
                            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', margin: 0 }} title="Excel Yükle">
                                <i className="material-icons-round">upload_file</i>
                                <input type="file" accept=".xlsx,.xls" hidden onChange={importExcel} />
                            </label>
                        </div>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleAdd}>
                            <div className="form-group">
                                <label>Kategori</label>
                                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required>
                                    <option value="">Seçiniz...</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Ad</label>
                                <input type="text" value={form.name} required
                                    onChange={e => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Soyad</label>
                                <input type="text" value={form.surname} required
                                    onChange={e => setForm({ ...form, surname: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Kulüp / Okul</label>
                                <input type="text" value={form.club}
                                    onChange={e => setForm({ ...form, club: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Doğum Tarihi</label>
                                <input type="date" value={form.dob} required
                                    onChange={e => setForm({ ...form, dob: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Profil Fotoğrafı</label>
                                <input type="file" accept="image/*" onChange={onPhotoChange} />
                                {imgB64 && (
                                    <img src={imgB64} alt=""
                                        style={{ marginTop: 10, width: 80, height: 80, objectFit: 'cover', borderRadius: '50%' }} />
                                )}
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                                <i className="material-icons-round">save</i> KAYDET
                            </button>
                        </form>
                    </div>
                </div>

                {/* ── LIST ─────────────────────────────────────────────── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                <div className="card">
                    <div className="card-header flex-between">
                        <h3 className="card-title">Kayıtlı Sporcular</h3>
                        <div className="text-muted">{athleteList.length} Sporcu</div>
                    </div>

                    {selectedIds.size > 0 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', margin: '0 16px',
                            background: 'rgba(0,86,210,0.15)', border: '1px solid rgba(0,86,210,0.4)',
                            borderRadius: 10,
                        }}>
                            <span style={{ color: 'var(--accent-primary, #F43F5E)', fontWeight: 600, fontSize: '0.9rem' }}>
                                {selectedIds.size} sporcu seçili
                            </span>
                            <select value={bulkCatId} onChange={e => setBulkCatId(e.target.value)} style={{ flex: 1, maxWidth: 260 }}>
                                <option value="">Kategori seç...</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button className="btn btn-primary btn-sm" onClick={applyBulkCategory}>
                                <i className="material-icons-round">check</i> Uygula
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={clearSel}>İptal</button>
                        </div>
                    )}

                    <div className="card-body" style={{ padding: 0 }}>
                        <div className="table-responsive">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 36, textAlign: 'center' }}>
                                            <input type="checkbox"
                                                checked={selectedIds.size > 0 && selectedIds.size === athleteList.length}
                                                onChange={e => toggleAll(e.target.checked)} />
                                        </th>
                                        <th style={{ width: 50 }}>Foto</th>
                                        <th>Ad Soyad</th>
                                        <th>Kulüp</th>
                                        <th>Kategori</th>
                                        <th>D.Tarihi</th>
                                        <th>İşlem</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {athleteList.length === 0 && (
                                        <tr><td colSpan={7} className="text-center text-muted" style={{ padding: 24 }}>Kayıt Yok</td></tr>
                                    )}
                                    {athleteList.map(a => {
                                        const dob = a.dob ? new Date(a.dob).toLocaleDateString('tr-TR') : '-';
                                        const img = a.profilePic || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
                                        const resolvedName = catName(a.category);
                                        const isUnmatched = !resolvedName && a.category;
                                        const displayCat = resolvedName || a.category || '-';
                                        const isChecked = selectedIds.has(a.id);
                                        const isEditing = editingCatId === a.id;
                                        return (
                                            <tr key={a.id} style={isChecked ? { background: 'rgba(0,86,210,0.12)' } : {}}>
                                                <td style={{ textAlign: 'center' }}>
                                                    <input type="checkbox" checked={isChecked} onChange={() => toggleSel(a.id)} />
                                                </td>
                                                <td>
                                                    <img src={img} alt="" style={{
                                                        width: 40, height: 40, borderRadius: '50%', objectFit: 'cover',
                                                        border: '1px solid #ddd',
                                                    }} />
                                                </td>
                                                <td><strong>{a.name} {a.surname}</strong></td>
                                                <td>{a.club || '-'}</td>
                                                <td>
                                                    {isEditing ? (
                                                        <select autoFocus
                                                            defaultValue={a.category || ''}
                                                            onChange={e => saveInlineCat(a.id, e.target.value)}
                                                            onBlur={() => setEditingCatId(null)}
                                                            style={{ width: '100%', fontSize: '0.82rem' }}>
                                                            <option value="">Seçiniz...</option>
                                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                        </select>
                                                    ) : (
                                                        <span onClick={() => setEditingCatId(a.id)}
                                                            title={isUnmatched ? 'Eşleşmeyen kategori — düzenlemek için tıkla' : 'Kategori değiştir'}
                                                            style={{
                                                                display: 'inline-block', padding: '2px 8px', borderRadius: 6,
                                                                fontSize: '0.78rem', cursor: 'pointer',
                                                                background: isUnmatched ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)',
                                                                color: isUnmatched ? '#ef4444' : 'inherit',
                                                                border: '1px solid transparent',
                                                            }}>
                                                            {isUnmatched ? '⚠ ' : ''}{displayCat}
                                                        </span>
                                                    )}
                                                </td>
                                                <td>{dob}</td>
                                                <td>
                                                    <button className="btn btn-sm btn-outline"
                                                        style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                                        onClick={() => handleDelete(a.id)}>
                                                        <i className="material-icons-round">delete</i>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
}
