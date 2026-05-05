/**
 * JuryPage.jsx
 * Mevcut jury.html — Jüri panelleri, hakem atamaları, kategori atamaları,
 * hakem link üretici.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}/juryPanels/{panelId}
 *   competitions/{compId}/categories/{catId}/juryPanelId
 *   competitions/{compId}/jury (legacy)
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, set, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';

const ROLES = [
    { id: 'cjp', name: 'CJP', color: '#f43f5e' },
    { id: 'd1',  name: 'D1',  color: '#fbbf24' },
    { id: 'd2',  name: 'D2',  color: '#fbbf24' },
    { id: 'e1',  name: 'E1',  color: '#3b82f6' },
    { id: 'e2',  name: 'E2',  color: '#3b82f6' },
    { id: 'e3',  name: 'E3',  color: '#3b82f6' },
    { id: 'e4',  name: 'E4',  color: '#3b82f6' },
    { id: 'e5',  name: 'E5',  color: '#3b82f6' },
    { id: 'e6',  name: 'E6',  color: '#3b82f6' },
];

export default function JuryPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm, prompt } = useNotification();

    const compId = getActiveCompId();

    const [juryPanels, setJuryPanels] = useState({});
    const [categories, setCategories] = useState({});
    const [activePanelId, setActivePanelId] = useState(null);
    const [currentMembers, setCurrentMembers] = useState({}); // {role: name}
    const [panelName, setPanelName] = useState('');

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        loadData();
    }, [compId]);

    async function loadData() {
        const snap = await get(ref(db, `competitions/${compId}`));
        if (!snap.exists()) return;
        const data = snap.val();
        const panels = data.juryPanels || {};

        // Migration: legacy /jury yapısını panel'a çevir
        if (Object.keys(panels).length === 0 && data.jury) {
            const id = 'panel_default';
            panels[id] = { id, name: 'Ana Panel', members: data.jury };
            await set(ref(db, `competitions/${compId}/juryPanels/${id}`), panels[id]);
        }

        setJuryPanels(panels);
        setCategories(data.categories || {});

        const firstId = Object.keys(panels)[0];
        if (firstId && !activePanelId) {
            setActivePanelId(firstId);
            setCurrentMembers(panels[firstId].members || {});
            setPanelName(panels[firstId].name || '');
        }
    }

    function syncCurrentToMemory() {
        if (!activePanelId) return;
        setJuryPanels(prev => ({
            ...prev,
            [activePanelId]: {
                ...(prev[activePanelId] || { id: activePanelId }),
                name: panelName,
                members: { ...currentMembers },
            },
        }));
    }

    function selectPanel(id) {
        syncCurrentToMemory();
        setActivePanelId(id);
        const p = juryPanels[id];
        setCurrentMembers(p?.members || {});
        setPanelName(p?.name || '');
    }

    async function createPanel() {
        const name = await prompt('Yeni Panel', 'Panel ismi giriniz', '');
        if (!name) return;
        const id = `panel_${Date.now()}`;
        const newP = { id, name, members: {} };
        syncCurrentToMemory();
        setJuryPanels(prev => ({ ...prev, [id]: newP }));
        setActivePanelId(id);
        setCurrentMembers({});
        setPanelName(name);
    }

    async function deletePanel() {
        if (!activePanelId) return;
        if (Object.keys(juryPanels).length <= 1) {
            toast('En az bir panel olmalı', 'warning');
            return;
        }
        const ok = await confirm('Panel Sil', `"${panelName}" panelini silmek istiyor musunuz?`);
        if (!ok) return;
        await remove(ref(db, `competitions/${compId}/juryPanels/${activePanelId}`));
        const next = { ...juryPanels };
        delete next[activePanelId];
        setJuryPanels(next);
        const firstId = Object.keys(next)[0];
        setActivePanelId(firstId || null);
        setCurrentMembers(firstId ? (next[firstId].members || {}) : {});
        setPanelName(firstId ? (next[firstId].name || '') : '');
        toast('Panel silindi', 'info');
    }

    async function updateCategoryAssignment(catId, panelId) {
        await update(ref(db, `competitions/${compId}/categories/${catId}`), {
            juryPanelId: panelId || null,
        });
        setCategories(prev => ({
            ...prev,
            [catId]: { ...prev[catId], juryPanelId: panelId },
        }));
    }

    async function saveAll() {
        try {
            syncCurrentToMemory();
            const updates = {};
            const panelsToSave = { ...juryPanels };
            if (activePanelId) {
                panelsToSave[activePanelId] = {
                    ...(panelsToSave[activePanelId] || { id: activePanelId }),
                    name: panelName,
                    members: { ...currentMembers },
                };
            }
            Object.entries(panelsToSave).forEach(([id, p]) => {
                updates[`competitions/${compId}/juryPanels/${id}`] = p;
            });
            await update(ref(db), updates);
            toast('Kaydedildi', 'success');
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        }
    }

    async function copyLink(url) {
        try {
            await navigator.clipboard.writeText(url);
            toast('Link kopyalandı', 'success');
        } catch {
            toast('Kopyalanamadı', 'error');
        }
    }

    const panelEntries = Object.values(juryPanels);
    const assignedCats = useMemo(() => {
        return Object.values(categories).filter(c => c.juryPanelId === activePanelId);
    }, [categories, activePanelId]);

    // Hakem linkleri
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}` : '';
    const judgeLinks = ROLES.map(r => {
        const role = r.id === 'cjp' ? 'cjp' : (r.id.startsWith('d') ? 'judge-d' : 'judge-e');
        const idPart = r.id.startsWith('e') ? r.id.slice(1) : '';
        const path = r.id === 'cjp'
            ? `/cjp?comp=${compId}&panel=${activePanelId || ''}`
            : `/judge-cockpit?comp=${compId}&role=${role}&id=${idPart}&panel=${activePanelId || ''}`;
        return { ...r, url: `${baseUrl}${path}` };
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1 }}>JÜRİ YÖNETİMİ</span>
                </div>
                <button className="btn btn-primary btn-sm" onClick={saveAll}>
                    <i className="material-icons-round">save</i> KAYDET
                </button>
            </nav>

            <div className="container" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>

                {/* ── SIDEBAR ──────────────────────────────────────────────────── */}
                <div className="card" style={{ height: 'fit-content' }}>
                    <div className="card-header">
                        <h3 className="card-title">Jüri Panelleri</h3>
                    </div>
                    <div className="card-body" style={{ padding: 8 }}>
                        {panelEntries.map(p => {
                            const count = Object.values(categories).filter(c => c.juryPanelId === p.id).length;
                            const isActive = p.id === activePanelId;
                            return (
                                <div key={p.id} onClick={() => selectPanel(p.id)} style={{
                                    padding: 12, margin: '4px 0', borderRadius: 10, cursor: 'pointer',
                                    background: isActive ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.03)',
                                    border: `1px solid ${isActive ? 'var(--accent-primary,#F43F5E)' : 'rgba(255,255,255,0.05)'}`,
                                    transition: 'all 0.2s',
                                }}>
                                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>{count} kategori</div>
                                </div>
                            );
                        })}
                        <button className="btn btn-outline"
                            style={{ width: '100%', marginTop: 8, borderStyle: 'dashed' }}
                            onClick={createPanel}>
                            <i className="material-icons-round">add</i> YENİ PANEL
                        </button>
                    </div>
                </div>

                {/* ── EDITOR ───────────────────────────────────────────────────── */}
                {activePanelId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                        {/* Panel Adı */}
                        <div className="card">
                            <div className="card-header flex-between">
                                <input
                                    type="text"
                                    value={panelName}
                                    onChange={e => setPanelName(e.target.value)}
                                    style={{
                                        fontSize: '1.2rem', fontWeight: 700, background: 'transparent',
                                        border: 'none', outline: 'none', color: 'inherit', flex: 1,
                                    }}
                                />
                                <button className="btn btn-outline btn-sm"
                                    style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                    onClick={deletePanel}>
                                    <i className="material-icons-round">delete</i>
                                </button>
                            </div>
                        </div>

                        {/* Hakemler */}
                        <div className="card">
                            <div className="card-header">
                                <h3 className="card-title">Hakem İsimleri</h3>
                            </div>
                            <div className="card-body">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
                                    {ROLES.map(r => (
                                        <div key={r.id} style={{
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 10, padding: 12,
                                        }}>
                                            <div style={{
                                                display: 'inline-block', padding: '2px 8px',
                                                borderRadius: 4, background: `${r.color}22`, color: r.color,
                                                fontSize: '0.78rem', fontWeight: 700, marginBottom: 8,
                                            }}>{r.name}</div>
                                            <input
                                                type="text"
                                                placeholder="İsim"
                                                value={currentMembers[r.id] || ''}
                                                onChange={e => setCurrentMembers(prev => ({ ...prev, [r.id]: e.target.value }))}
                                                style={{ width: '100%' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Kategori Atamaları */}
                        <div className="card">
                            <div className="card-header">
                                <h3 className="card-title">Kategori Atamaları</h3>
                                <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                                    Aktif panel: <strong>{panelName}</strong> ({assignedCats.length} kategori)
                                </div>
                            </div>
                            <div className="card-body">
                                {Object.values(categories).length === 0 && (
                                    <div className="text-muted text-center" style={{ padding: 20 }}>
                                        Kategori tanımlı değil
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
                                    {Object.values(categories).map(c => (
                                        <div key={c.id} style={{
                                            background: c.juryPanelId === activePanelId
                                                ? 'rgba(244,63,94,0.1)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${c.juryPanelId === activePanelId
                                                ? 'var(--accent-primary,#F43F5E)' : 'rgba(255,255,255,0.06)'}`,
                                            borderRadius: 10, padding: 12,
                                        }}>
                                            <div style={{ fontWeight: 700, marginBottom: 6 }}>{c.name}</div>
                                            <select value={c.juryPanelId || ''}
                                                onChange={e => updateCategoryAssignment(c.id, e.target.value)}
                                                style={{ width: '100%', fontSize: '0.85rem' }}>
                                                <option value="">— Atanmadı —</option>
                                                {panelEntries.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Hakem Linkleri */}
                        <div className="card">
                            <div className="card-header">
                                <h3 className="card-title">Hakem Linkleri</h3>
                                <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                                    Her hakem için URL — kopyalayıp tablete/telefona gönderin
                                </div>
                            </div>
                            <div className="card-body">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
                                    {judgeLinks.map(l => (
                                        <div key={l.id} style={{
                                            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', gap: 10,
                                        }}>
                                            <div style={{
                                                padding: '2px 8px', borderRadius: 4,
                                                background: `${l.color}22`, color: l.color,
                                                fontSize: '0.78rem', fontWeight: 700, minWidth: 40, textAlign: 'center',
                                            }}>{l.name}</div>
                                            <div style={{ flex: 1, fontSize: '0.78rem', color: '#94a3b8', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                                {l.url}
                                            </div>
                                            <button className="btn btn-sm btn-outline" onClick={() => copyLink(l.url)}>
                                                <i className="material-icons-round">content_copy</i>
                                            </button>
                                            <a href={l.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline">
                                                <i className="material-icons-round">open_in_new</i>
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="card">
                        <div className="card-body text-center text-muted" style={{ padding: 80 }}>
                            Panel oluşturun veya seçin
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
