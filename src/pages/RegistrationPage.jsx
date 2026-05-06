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
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { DataService, Utils, getAthleteName, getAthleteClub } from '../lib/DataService';

export default function RegistrationPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm } = useNotification();

    const compId = getActiveCompId();
    const dsRef = useRef(null);

    const [categories, setCategories] = useState([]); // [{id,name,type}]
    const [athletes, setAthletes] = useState({});
    const [pairs, setPairs] = useState({});
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [editingCatId, setEditingCatId] = useState(null); // athlete id currently editing category inline
    const [bulkCatId, setBulkCatId] = useState('');
    const [filterCat, setFilterCat] = useState(''); // '' = tümü, '__unmatched__' = eşleşmeyenler, catId veya ham string
    const [pairCatFilter, setPairCatFilter] = useState(''); // selected sync category for pair management
    const [pairSelA, setPairSelA] = useState(null);   // first athlete selected for pairing
    const [pairSelB, setPairSelB] = useState(null);   // second athlete selected for pairing

    const [form, setForm] = useState({
        name: '', surname: '', club: '', category: '', dob: '',
    });
    const [imgB64, setImgB64] = useState(null);

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        dsRef.current = new DataService(compId);

        // Kategorileri canlı dinle (real-time — sync kategori eklenince hemen güncellenir)
        const unsubC = onValue(ref(db, `competitions/${compId}/categories`), snap => {
            if (!snap.exists()) {
                setCategories([{ id: 'cat_default', name: 'Genel Kategori', type: 'individual' }]);
                return;
            }
            const cats = Object.values(snap.val()).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type || 'individual',
                ageGroup: c.ageGroup,
                gender: c.gender,
                ruleset: c.ruleset,
            }));
            setCategories(cats);
        });

        // Sporcuları canlı dinle
        const unsubA = onValue(ref(db, `competitions/${compId}/athletes`), snap => {
            setAthletes(snap.val() || {});
        });

        // Çiftleri canlı dinle
        const unsubP = dsRef.current.listenPairs(p => setPairs(p || {}));

        return () => { unsubC(); unsubA(); unsubP(); };
    }, [compId]);

    const athleteList = useMemo(() => Object.values(athletes), [athletes]);
    const catName = (catId) => categories.find(c => c.id === catId)?.name || null;
    const syncCategories = useMemo(() => categories.filter(c => c.type === 'sync'), [categories]);

    // İsmi boş sporcular (Excel'den hatalı içe aktarılan)
    const missingNameAthletes = useMemo(() => {
        return athleteList.filter(a => {
            const n = (a.name || a.ad || a.firstName || a.isim || '').trim();
            const s = (a.surname || a.soyad || a.lastName || a.soyisim || '').trim();
            return !n && !s;
        });
    }, [athleteList]);

    // Eşleşmeyen ham kategori değerlerini bul (Excel'den gelenler gibi)
    const unmatchedGroups = useMemo(() => {
        const catIds = new Set(categories.map(c => c.id));
        const groups = {};
        athleteList.forEach(a => {
            const raw = a.category || a.catId || a.categoryId || '';
            if (raw && !catIds.has(raw)) {
                if (!groups[raw]) groups[raw] = 0;
                groups[raw]++;
            }
        });
        return groups; // { 'ham_deger': count }
    }, [athleteList, categories]);

    // Filtrelenmiş sporcu listesi
    const displayedAthletes = useMemo(() => {
        if (!filterCat) return athleteList;
        const catIds = new Set(categories.map(c => c.id));
        if (filterCat === '__unmatched__') {
            return athleteList.filter(a => {
                const raw = a.category || a.catId || a.categoryId || '';
                return raw && !catIds.has(raw);
            });
        }
        if (filterCat === '__missingname__') {
            return athleteList.filter(a => {
                const n = (a.name || a.ad || a.firstName || a.isim || '').trim();
                const s = (a.surname || a.soyad || a.lastName || a.soyisim || '').trim();
                return !n && !s;
            });
        }
        // Belirli bir kategori (eşleşen veya ham)
        return athleteList.filter(a =>
            a.category === filterCat || a.catId === filterCat || a.categoryId === filterCat
        );
    }, [athleteList, filterCat, categories]);

    // Çift yönetimi yardımcıları
    const pairList = useMemo(() => Object.values(pairs), [pairs]);
    const pairedAthleteIds = useMemo(() => {
        const ids = new Set();
        pairList.forEach(p => { ids.add(p.athlete1Id); ids.add(p.athlete2Id); });
        return ids;
    }, [pairList]);

    // Tüm kategori sporcuları — eşleşmiş ve eşleşmemiş birlikte
    const filteredSyncAthletes = useMemo(() => {
        if (!pairCatFilter) return [];
        const selectedCat = categories.find(c => c.id === pairCatFilter);
        const selectedCatName = selectedCat?.name || '';
        return athleteList.filter(a => {
            const aCat = a.category || a.catId || a.categoryId || '';
            return aCat === pairCatFilter || (selectedCatName && aCat === selectedCatName);
        });
    }, [athleteList, pairCatFilter, categories]);

    // Sporcunun çift bilgisini bul
    const pairOf = useMemo(() => {
        const map = {}; // athleteId → pair
        pairList.forEach(p => {
            map[p.athlete1Id] = p;
            map[p.athlete2Id] = p;
        });
        return map;
    }, [pairList]);

    const filteredPairs = useMemo(() => {
        if (!pairCatFilter) return [];
        return pairList.filter(p => p.categoryId === pairCatFilter);
    }, [pairList, pairCatFilter]);

    function togglePairSel(ath) {
        // Zaten bir çiftte ise seçilemez
        if (pairOf[ath.id]) return;
        if (pairSelA?.id === ath.id) { setPairSelA(null); return; }
        if (pairSelB?.id === ath.id) { setPairSelB(null); return; }
        if (!pairSelA) { setPairSelA(ath); return; }
        if (!pairSelB) { setPairSelB(ath); return; }
        setPairSelB(ath);
    }

    async function handleCreatePair() {
        if (!pairSelA || !pairSelB) { toast('Lütfen iki sporcu seçin', 'warning'); return; }
        if (!pairCatFilter) { toast('Kategori seçin', 'warning'); return; }
        try {
            await dsRef.current.createPair(pairSelA, pairSelB, pairCatFilter);
            setPairSelA(null);
            setPairSelB(null);
            toast(`${pairSelA.surname} & ${pairSelB.surname} çifti oluşturuldu`, 'success');
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        }
    }

    async function handleDissolvePair(pair) {
        const ok = await confirm('Çifti Boz', `"${pair.displayName}" çiftini bozmak istediğinize emin misiniz?`);
        if (!ok) return;
        try {
            await dsRef.current.dissolvePair(pair.id, pair.athlete1Id, pair.athlete2Id);
            toast('Çift bozuldu.', 'info');
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        }
    }

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
        setSelectedIds(checked ? new Set(displayedAthletes.map(a => a.id)) : new Set());
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
    async function downloadTemplate() {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([["Ad", "Soyad", "Kulüp", "Kategori", "Doğum Tarihi (GG.AA.YYYY)", "Göğüs No"]]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sporcular');
        XLSX.writeFile(wb, 'Sporcu_Kayit_Sablon.xlsx');
    }

    async function importExcel(e) {
        const file = e.target.files?.[0];
        if (!file) return;
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

        // Robust column finder: tries exact keys first, then Turkish-normalized case-insensitive match
        const normKey = s => String(s || '').toLowerCase()
            .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
            .replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ö/g, 'o').replace(/Ö/g, 'o')
            .replace(/ü/g, 'u').replace(/Ü/g, 'u').replace(/ç/g, 'c').replace(/Ç/g, 'c')
            .trim();
        const findCol = (row, ...keys) => {
            // 1. Exact match
            for (const k of keys) {
                if (row[k] !== undefined) {
                    const v = String(row[k]).trim();
                    if (v) return v;
                }
            }
            // 2. Normalized case-insensitive match
            const rowKeys = Object.keys(row);
            for (const k of keys) {
                const nk = normKey(k);
                const match = rowKeys.find(rk => normKey(rk) === nk);
                if (match !== undefined) {
                    const v = String(row[match]).trim();
                    if (v) return v;
                }
            }
            return '';
        };

        const unmatched = new Set();
        let added = 0;
        let skipped = 0;
        for (const row of rows) {
            const name    = findCol(row, 'Ad', 'Adı', 'ADI', 'Name', 'İsim', 'isim', 'Sporcu Adı', 'Sporcu Adi', 'First Name', 'FirstName');
            const surname = findCol(row, 'Soyad', 'Soyadı', 'SOYADI', 'Surname', 'Last Name', 'LastName', 'Sporcu Soyadı', 'Sporcu Soyadi');
            if (!name || !surname) { skipped++; continue; }

            const cRaw = findCol(row, 'Kategori', 'Kategori Adı', 'Category', 'Kategori Adi');
            const catId = findCatId(cRaw);
            if (cRaw && catId === cRaw) unmatched.add(cRaw);

            let dob = findCol(row, 'Doğum Tarihi', 'Doğum Tarihi (GG.AA.YYYY)', 'Dogum Tarihi', 'DOB', 'Birth Date');
            // Handle Excel serial date numbers
            if (!dob && row['Doğum Tarihi'] !== undefined && typeof row['Doğum Tarihi'] === 'number') {
                const d = new Date(Math.round((row['Doğum Tarihi'] - 25569) * 86400 * 1000));
                dob = d.toISOString().split('T')[0];
            } else if (dob && !isNaN(Number(dob))) {
                // Numeric string from findCol
                const serial = Number(dob);
                if (serial > 10000) { // likely an Excel date serial
                    const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
                    dob = d.toISOString().split('T')[0];
                }
            }

            const club = findCol(row, 'Kulüp', 'Kulup', 'Kulüp Adı', 'Club', 'Kulup Adi');
            const bib  = findCol(row, 'Göğüs No', 'Gogus No', 'Bib', 'Bib No', 'Dorsal');

            const id = Utils.id('ath_xl');
            await set(ref(db, `competitions/${compId}/athletes/${id}`), {
                id,
                name,
                surname,
                club,
                category: catId,
                dob,
                bib,
                regDate: Date.now(),
            });
            added++;
        }
        let msg = `${added} sporcu eklendi.`;
        if (skipped > 0) msg += ` ${skipped} satır atlandı (Ad/Soyad eksik).`;
        if (unmatched.size > 0) msg += ` ${unmatched.size} kategori eşleşmedi.`;
        toast(msg, skipped > 0 || unmatched.size > 0 ? 'warning' : 'success');
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                {filterCat ? `${displayedAthletes.length} / ` : ''}{athleteList.length} Sporcu
                            </div>
                            {missingNameAthletes.length > 0 && (
                                <span style={{
                                    fontSize: '0.75rem', fontWeight: 700,
                                    background: 'rgba(249,115,22,0.15)', color: '#f97316',
                                    padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(249,115,22,0.3)',
                                    cursor: 'pointer',
                                }} onClick={() => { setFilterCat('__missingname__'); setSelectedIds(new Set()); }}
                                title="İsim eksik sporcuları göster">
                                    ⚠ {missingNameAthletes.length} isim eksik
                                </span>
                            )}
                            {Object.keys(unmatchedGroups).length > 0 && (
                                <span style={{
                                    fontSize: '0.75rem', fontWeight: 700,
                                    background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                                    padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)',
                                }}>
                                    ⚠ {Object.values(unmatchedGroups).reduce((a, b) => a + b, 0)} eşleşmeyen
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Filtre Satırı */}
                    <div style={{
                        padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                    }}>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>FİLTRE:</span>
                        <button
                            className={`btn btn-sm ${!filterCat ? 'btn-primary' : 'btn-outline'}`}
                            style={{ fontSize: '0.78rem' }}
                            onClick={() => { setFilterCat(''); setSelectedIds(new Set()); }}>
                            Tümü ({athleteList.length})
                        </button>
                        {missingNameAthletes.length > 0 && (
                            <button
                                className={`btn btn-sm ${filterCat === '__missingname__' ? 'btn-primary' : 'btn-outline'}`}
                                style={{ fontSize: '0.78rem', color: filterCat !== '__missingname__' ? '#f97316' : undefined, borderColor: 'rgba(249,115,22,0.4)' }}
                                onClick={() => { setFilterCat('__missingname__'); setSelectedIds(new Set()); }}>
                                ⚠ İsim Eksik ({missingNameAthletes.length})
                            </button>
                        )}
                        {Object.keys(unmatchedGroups).length > 0 && (
                            <button
                                className={`btn btn-sm ${filterCat === '__unmatched__' ? 'btn-primary' : 'btn-outline'}`}
                                style={{ fontSize: '0.78rem', color: filterCat !== '__unmatched__' ? '#ef4444' : undefined, borderColor: 'rgba(239,68,68,0.4)' }}
                                onClick={() => { setFilterCat('__unmatched__'); setSelectedIds(new Set()); }}>
                                ⚠ Eşleşmeyenler ({Object.values(unmatchedGroups).reduce((a, b) => a + b, 0)})
                            </button>
                        )}
                        {categories.map(c => {
                            const cnt = athleteList.filter(a =>
                                a.category === c.id || a.catId === c.id || a.categoryId === c.id
                            ).length;
                            if (cnt === 0) return null;
                            const isSync = c.type === 'sync';
                            return (
                                <button key={c.id}
                                    className={`btn btn-sm ${filterCat === c.id ? 'btn-primary' : 'btn-outline'}`}
                                    style={{ fontSize: '0.78rem' }}
                                    onClick={() => {
                                        setFilterCat(c.id);
                                        setSelectedIds(new Set());
                                        // Sync kategori seçilince çift yönetimini de o kategoriye getir
                                        if (isSync) { setPairCatFilter(c.id); setPairSelA(null); setPairSelB(null); }
                                    }}>
                                    {isSync && <i className="material-icons-round" style={{ fontSize: 11, verticalAlign: 'middle', marginRight: 3, color: filterCat === c.id ? 'white' : '#c084fc' }}>sync</i>}
                                    {c.name} ({cnt})
                                </button>
                            );
                        })}
                        {/* Eşleşmeyen ham kategoriler */}
                        {Object.entries(unmatchedGroups).map(([raw, cnt]) => (
                            <button key={raw}
                                className={`btn btn-sm ${filterCat === raw ? 'btn-primary' : 'btn-outline'}`}
                                style={{ fontSize: '0.75rem', color: filterCat !== raw ? '#ef4444' : undefined, borderColor: 'rgba(239,68,68,0.35)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={`"${raw}" — ${cnt} sporcu`}
                                onClick={() => { setFilterCat(raw); setSelectedIds(new Set()); }}>
                                ⚠ {raw} ({cnt})
                            </button>
                        ))}
                        {filterCat && (
                            <button className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem', marginLeft: 'auto' }}
                                onClick={() => { setFilterCat(''); setSelectedIds(new Set()); }}>
                                <i className="material-icons-round" style={{ fontSize: 14 }}>close</i> Filtreyi Kaldır
                            </button>
                        )}
                    </div>

                    {/* Filtredeki tümünü seç */}
                    {filterCat && displayedAthletes.length > 0 && selectedIds.size === 0 && (
                        <div style={{
                            padding: '8px 16px', background: 'rgba(56,189,248,0.06)',
                            borderBottom: '1px solid rgba(56,189,248,0.15)',
                            display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                            <i className="material-icons-round" style={{ fontSize: 16, color: '#38bdf8' }}>info</i>
                            <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                                {displayedAthletes.length} sporcu gösteriliyor
                            </span>
                            <button className="btn btn-sm btn-outline" style={{ fontSize: '0.78rem', color: '#38bdf8', borderColor: 'rgba(56,189,248,0.4)' }}
                                onClick={() => toggleAll(true)}>
                                <i className="material-icons-round" style={{ fontSize: 14 }}>select_all</i> Tümünü Seç ({displayedAthletes.length})
                            </button>
                        </div>
                    )}

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
                                                checked={displayedAthletes.length > 0 && displayedAthletes.every(a => selectedIds.has(a.id))}
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
                                    {displayedAthletes.length === 0 && (
                                        <tr><td colSpan={7} className="text-center text-muted" style={{ padding: 24 }}>
                                            {filterCat ? 'Bu filtrede sporcu yok' : 'Kayıt Yok'}
                                        </td></tr>
                                    )}
                                    {displayedAthletes.map(a => {
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
                                                <td>
                                                    <strong>{getAthleteName(a)}</strong>
                                                    {(!(a.name || a.ad || a.firstName || a.isim || '').trim() &&
                                                      !(a.surname || a.soyad || a.lastName || a.soyisim || '').trim()) && (
                                                        <span style={{
                                                            marginLeft: 6, fontSize: '0.7rem', fontWeight: 700,
                                                            background: 'rgba(249,115,22,0.15)', color: '#f97316',
                                                            padding: '1px 6px', borderRadius: 4,
                                                        }} title="Ad/Soyad boş — yeniden içe aktarın">İSİM EKSİK</span>
                                                    )}
                                                </td>
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
                {/* ── ÇİFT YÖNETİMİ (Sync Kategoriler) ──────────────────── */}
                {syncCategories.length > 0 && (
                <div className="card">
                    <div className="card-header flex-between">
                        <h3 className="card-title">
                            <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 6, color: '#c084fc' }}>sync</i>
                            Senkronize Çift Yönetimi
                        </h3>
                        <select value={pairCatFilter} onChange={e => { setPairCatFilter(e.target.value); setPairSelA(null); setPairSelB(null); setFilterCat(e.target.value); setSelectedIds(new Set()); }}
                            style={{ minWidth: 220, fontSize: '0.85rem' }}>
                            <option value="">Sync Kategori Seçin...</option>
                            {syncCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {pairCatFilter && (
                    <div className="card-body">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                            {/* Sol: Tüm sporcular — eşleşmiş + eşleşmemiş */}
                            <div>
                                <div style={{ fontWeight: 700, marginBottom: 10, color: '#94a3b8', fontSize: '0.8rem', letterSpacing: 1, textTransform: 'uppercase' }}>
                                    KATEGORİ SPORCULAR ({filteredSyncAthletes.length})
                                </div>
                                {filteredSyncAthletes.length === 0 && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem', padding: '16px 0' }}>
                                        Bu kategoride sporcu yok.
                                    </div>
                                )}
                                {filteredSyncAthletes.map(a => {
                                    const pair = pairOf[a.id];
                                    const isPaired = !!pair;
                                    const isSelA = pairSelA?.id === a.id;
                                    const isSelB = pairSelB?.id === a.id;
                                    const isSel = isSelA || isSelB;
                                    // Çiftteyse partneri bul
                                    const partnerId = pair ? (pair.athlete1Id === a.id ? pair.athlete2Id : pair.athlete1Id) : null;
                                    const partner = partnerId ? athletes[partnerId] : null;
                                    return (
                                        <div key={a.id}
                                            onClick={() => !isPaired && togglePairSel(a)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '8px 12px', borderRadius: 8, marginBottom: 6,
                                                cursor: isPaired ? 'default' : 'pointer',
                                                background: isPaired ? 'rgba(34,197,94,0.08)' : isSel ? 'rgba(192,132,252,0.2)' : 'rgba(255,255,255,0.05)',
                                                border: isPaired ? '1px solid rgba(34,197,94,0.3)' : isSel ? '1.5px solid #c084fc' : '1px solid rgba(255,255,255,0.1)',
                                                transition: 'all 0.15s',
                                            }}>
                                            <div style={{
                                                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                background: isPaired ? 'rgba(34,197,94,0.3)' : isSel ? '#c084fc' : 'rgba(255,255,255,0.1)',
                                                fontSize: '0.65rem', fontWeight: 700,
                                                color: isPaired ? '#4ade80' : isSel ? '#fff' : '#94a3b8',
                                                flexShrink: 0,
                                            }}>
                                                {isPaired ? '✓' : isSelA ? '1' : isSelB ? '2' : '○'}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{getAthleteName(a)}</div>
                                                {isPaired && partner && (
                                                    <div style={{ fontSize: '0.72rem', color: '#4ade80', marginTop: 1 }}>
                                                        <i className="material-icons-round" style={{ fontSize: 11, verticalAlign: 'middle', marginRight: 2 }}>link</i>
                                                        {getAthleteName(partner)} ile çift
                                                    </div>
                                                )}
                                                {isPaired && !partner && (
                                                    <div style={{ fontSize: '0.72rem', color: '#4ade80', marginTop: 1 }}>
                                                        <i className="material-icons-round" style={{ fontSize: 11, verticalAlign: 'middle', marginRight: 2 }}>link</i>
                                                        {pair.displayName}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{getAthleteClub(a) || '—'}</div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {(pairSelA || pairSelB) && (
                                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(192,132,252,0.1)', borderRadius: 8, border: '1px solid rgba(192,132,252,0.3)' }}>
                                        <div style={{ fontSize: '0.8rem', color: '#c084fc', fontWeight: 600, marginBottom: 6 }}>Seçilenler:</div>
                                        {pairSelA && <div style={{ fontSize: '0.85rem' }}>① {getAthleteName(pairSelA)}</div>}
                                        {pairSelB && <div style={{ fontSize: '0.85rem' }}>② {getAthleteName(pairSelB)}</div>}
                                        <button
                                            className="btn btn-primary btn-sm"
                                            style={{ marginTop: 10, width: '100%', background: 'linear-gradient(135deg,#c084fc,#a855f7)' }}
                                            disabled={!pairSelA || !pairSelB}
                                            onClick={handleCreatePair}>
                                            <i className="material-icons-round">link</i> Çift Oluştur
                                        </button>
                                        <button className="btn btn-outline btn-sm" style={{ marginTop: 6, width: '100%' }}
                                            onClick={() => { setPairSelA(null); setPairSelB(null); }}>
                                            Seçimi Temizle
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Sağ: Mevcut Çiftler */}
                            <div>
                                <div style={{ fontWeight: 700, marginBottom: 10, color: '#94a3b8', fontSize: '0.8rem', letterSpacing: 1, textTransform: 'uppercase' }}>
                                    MEVCUT ÇİFTLER ({filteredPairs.length})
                                </div>
                                {filteredPairs.length === 0 && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem', padding: '16px 0' }}>
                                        Henüz çift oluşturulmamış.
                                    </div>
                                )}
                                {filteredPairs.map(pair => {
                                    const a1 = athletes[pair.athlete1Id];
                                    const a2 = athletes[pair.athlete2Id];
                                    return (
                                        <div key={pair.id} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 14px', borderRadius: 8, marginBottom: 6,
                                            background: 'rgba(34,197,94,0.08)',
                                            border: '1px solid rgba(34,197,94,0.25)',
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#4ade80' }}>
                                                    <i className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>sync</i>
                                                    {pair.displayName}
                                                </div>
                                                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 4 }}>
                                                    <div>① {a1 ? getAthleteName(a1) : pair.athlete1Id}</div>
                                                    <div>② {a2 ? getAthleteName(a2) : pair.athlete2Id}</div>
                                                </div>
                                                {pair.club && <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>{pair.club}</div>}
                                            </div>
                                            <button className="btn btn-sm btn-outline"
                                                style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', flexShrink: 0, marginLeft: 8 }}
                                                onClick={() => handleDissolvePair(pair)}
                                                title="Çifti Boz">
                                                <i className="material-icons-round">link_off</i>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                        </div>
                    </div>
                    )}
                </div>
                )}

                </div>
            </div>
        </div>
    );
}
