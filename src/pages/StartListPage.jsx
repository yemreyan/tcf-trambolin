/**
 * StartListPage.jsx
 * Mevcut start_list.html — Çıkış sırası. Kulüplere göre gruplama,
 * sıralama (kulüp adına göre / karışık), sıra numarasını elle değiştirme,
 * yukarı/aşağı oku ile taşıma, çoğaltma, silme.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}/categories
 *   competitions/{compId}/athletes
 *   competitions/{compId}/startOrder/{catId}      → athlete id array
 *   competitions/{compId}/categories/{catId}/startList → populated list
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, set, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';

export default function StartListPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm } = useNotification();

    const compId = getActiveCompId();

    const [categories, setCategories] = useState({});
    const [selectedCatId, setSelectedCatId] = useState('');
    const [athleteList, setAthleteList] = useState([]);
    const [expandedClubs, setExpandedClubs] = useState(new Set());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        (async () => {
            const snap = await get(ref(db, `competitions/${compId}/categories`));
            setCategories(snap.val() || {});
        })();
    }, [compId]);

    useEffect(() => {
        if (!selectedCatId) { setAthleteList([]); return; }
        loadList(selectedCatId);
    }, [selectedCatId]);

    async function loadList(catId) {
        const [athSnap, orderSnap] = await Promise.all([
            get(ref(db, `competitions/${compId}/athletes`)),
            get(ref(db, `competitions/${compId}/startOrder/${catId}`)),
        ]);
        const athletesAll = athSnap.val() || {};
        const savedOrder = orderSnap.val();

        const filtered = Object.values(athletesAll)
            .filter(a => (a.category === catId) || (a.categoryId === catId) || (a.catId === catId));

        if (Array.isArray(savedOrder) && savedOrder.length > 0) {
            const mapById = {};
            filtered.forEach(a => { mapById[a.id] = a; });
            const ordered = savedOrder.map(id => mapById[id]).filter(Boolean);
            filtered.forEach(a => { if (!savedOrder.includes(a.id)) ordered.push(a); });
            setAthleteList(ordered);
        } else {
            const sorted = [...filtered].sort((a, b) => {
                const c = (a.club || '').localeCompare(b.club || '', 'tr');
                if (c !== 0) return c;
                return (a.surname || '').localeCompare(b.surname || '', 'tr');
            });
            setAthleteList(sorted);
        }
        setExpandedClubs(new Set(filtered.map(a => a.club || 'Bilinmeyen')));
    }

    const grouped = useMemo(() => {
        const g = {};
        athleteList.forEach((a, i) => {
            const c = a.club || 'Bilinmeyen';
            if (!g[c]) g[c] = [];
            g[c].push({ ...a, _index: i });
        });
        return g;
    }, [athleteList]);

    function toggleClub(club) {
        setExpandedClubs(prev => {
            const n = new Set(prev);
            n.has(club) ? n.delete(club) : n.add(club);
            return n;
        });
    }

    function move(index, dir) {
        setAthleteList(prev => {
            const arr = [...prev];
            const target = index + dir;
            if (target < 0 || target >= arr.length) return prev;
            [arr[index], arr[target]] = [arr[target], arr[index]];
            return arr;
        });
    }

    function updateDirectOrder(index, newVal) {
        const v = parseInt(newVal, 10);
        if (isNaN(v) || v < 1 || v > athleteList.length) return;
        const newIndex = v - 1;
        if (newIndex === index) return;
        setAthleteList(prev => {
            const arr = [...prev];
            const [item] = arr.splice(index, 1);
            arr.splice(newIndex, 0, item);
            return arr;
        });
    }

    async function duplicateAthlete(index) {
        setAthleteList(prev => {
            const arr = [...prev];
            const base = arr[index];
            const clone = {
                ...base,
                id: `${base.id}_copy_${Date.now()}`,
                uniqueId: `${base.id}_copy_${Date.now()}`,
            };
            arr.splice(index + 1, 0, clone);
            return arr;
        });
    }

    async function deleteItem(index) {
        const a = athleteList[index];
        const ok = await confirm('Listeden Sil', `${a.name} ${a.surname} — sadece çıkış listesinden çıkar. Sporcu silinmez.`);
        if (!ok) return;
        setAthleteList(prev => prev.filter((_, i) => i !== index));
    }

    function groupByClub() {
        setAthleteList(prev => {
            const arr = [...prev].sort((a, b) => {
                const c = (a.club || '').localeCompare(b.club || '', 'tr');
                if (c !== 0) return c;
                return (a.surname || '').localeCompare(b.surname || '', 'tr');
            });
            return arr;
        });
    }

    function shuffle() {
        // Her kulüp içini shuffle + kulüp sırasını shuffle
        const groups = {};
        athleteList.forEach(a => {
            const c = a.club || 'Bilinmeyen';
            if (!groups[c]) groups[c] = [];
            groups[c].push(a);
        });
        const clubs = Object.keys(groups);
        // Fisher-Yates
        for (let i = clubs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [clubs[i], clubs[j]] = [clubs[j], clubs[i]];
        }
        Object.values(groups).forEach(list => {
            for (let i = list.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [list[i], list[j]] = [list[j], list[i]];
            }
        });
        const flat = [];
        clubs.forEach(c => flat.push(...groups[c]));
        setAthleteList(flat);
    }

    async function saveOrder() {
        if (!selectedCatId) return;
        setSaving(true);
        try {
            const ids = athleteList.map(a => a.id);
            const updates = {};
            updates[`competitions/${compId}/startOrder/${selectedCatId}`] = ids;
            updates[`competitions/${compId}/categories/${selectedCatId}/startList`] =
                athleteList.map((a, i) => ({ id: a.id, order: i + 1 }));
            await update(ref(db), updates);
            toast('Çıkış sırası kaydedildi', 'success');
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1 }}>ÇIKIŞ SIRASI</span>
                </div>
            </nav>

            <div className="container" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
                <div className="card">
                    <div className="card-header" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select value={selectedCatId} onChange={e => setSelectedCatId(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
                            <option value="">Kategori seçiniz...</option>
                            {Object.values(categories).map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        <button className="btn btn-outline btn-sm" onClick={groupByClub} disabled={!selectedCatId}>
                            <i className="material-icons-round">group_work</i> Kulübe Göre
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={shuffle} disabled={!selectedCatId}>
                            <i className="material-icons-round">shuffle</i> Karıştır
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={saveOrder} disabled={!selectedCatId || saving}>
                            <i className="material-icons-round">save</i> {saving ? 'KAYDEDİLİYOR...' : 'KAYDET'}
                        </button>
                    </div>

                    <div className="card-body">
                        {!selectedCatId && (
                            <div className="text-center text-muted" style={{ padding: 40 }}>
                                Lütfen kategori seçin
                            </div>
                        )}
                        {selectedCatId && athleteList.length === 0 && (
                            <div className="text-center text-muted" style={{ padding: 40 }}>
                                Bu kategoride kayıtlı sporcu yok
                            </div>
                        )}

                        {Object.keys(grouped).map(club => {
                            const isOpen = expandedClubs.has(club);
                            const list = grouped[club];
                            return (
                                <div key={club} style={{
                                    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
                                    marginBottom: 10, overflow: 'hidden',
                                }}>
                                    <div onClick={() => toggleClub(club)} style={{
                                        padding: '12px 16px', cursor: 'pointer',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        background: 'rgba(255,255,255,0.03)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <i className="material-icons-round">{isOpen ? 'expand_less' : 'expand_more'}</i>
                                            <strong>{club}</strong>
                                            <span style={{ color: '#64748b', fontSize: '0.82rem' }}>— {list.length} sporcu</span>
                                        </div>
                                    </div>
                                    {isOpen && list.map(a => (
                                        <div key={a.id} style={{
                                            padding: '10px 16px',
                                            borderTop: '1px solid rgba(255,255,255,0.04)',
                                            display: 'flex', alignItems: 'center', gap: 12,
                                        }}>
                                            <input type="number"
                                                value={a._index + 1}
                                                min={1}
                                                max={athleteList.length}
                                                onChange={e => updateDirectOrder(a._index, e.target.value)}
                                                style={{
                                                    width: 52, textAlign: 'center', fontWeight: 700,
                                                    padding: '4px 6px', fontSize: '0.9rem',
                                                }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 700 }}>
                                                    {a.name} {a.surname}
                                                </div>
                                                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{a.club}</div>
                                            </div>
                                            <button className="btn btn-sm btn-outline" onClick={() => move(a._index, -1)} title="Yukarı">
                                                <i className="material-icons-round">arrow_upward</i>
                                            </button>
                                            <button className="btn btn-sm btn-outline" onClick={() => move(a._index, 1)} title="Aşağı">
                                                <i className="material-icons-round">arrow_downward</i>
                                            </button>
                                            <button className="btn btn-sm btn-outline" onClick={() => duplicateAthlete(a._index)} title="Çoğalt">
                                                <i className="material-icons-round">content_copy</i>
                                            </button>
                                            <button className="btn btn-sm btn-outline" style={{ color: '#ef4444' }}
                                                onClick={() => deleteItem(a._index)} title="Sil">
                                                <i className="material-icons-round">delete</i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
