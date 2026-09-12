/**
 * CreateFinalsPage.jsx
 * Mevcut create_finals.html — Final kategorileri oluşturma.
 *
 * Mantık:
 *   - Her kategoride sporcular r1+r2 toplamına göre (veya senior için max) sıralanır.
 *   - İlk 8 finalist, 9-10 yedek seçilir.
 *   - Finalistler A grubu (1-4) ve B grubu (5-8) olarak ikiye bölünür, her grup shuffle edilir.
 *   - Yeni kategori {catId}_final olarak oluşturulur, finalist sporcular
 *     YENİ bir id ({origId}_final) ile eklenir (isReserve=true ise yedek).
 *     Orijinal id `originalId` alanında saklanır.
 *
 * ÖNEMLİ: Finalist kaydının `id` alanı Firebase anahtarıyla aynı olmalıdır.
 * Aksi halde CJP finalde yayınlanan puanı eleme sonucunun üzerine yazar.
 *
 * Firebase yolları aynen korundu:
 *   competitions/{compId}/categories/{catId}_final
 *   competitions/{compId}/athletes/{uniqueId}
 *   competitions/{compId}/startOrder/{catId}_final
 *   competitions/{compId}/categories/{catId}_final/startList
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, set, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { getScoringRule, computeRoutineTotals } from '../lib/DataService';
import { useRules, resolveCategoryRules } from '../lib/Rules';

export default function CreateFinalsPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm } = useNotification();
    const rules = useRules(getActiveCompId());

    const compId = getActiveCompId();

    const [categories, setCategories] = useState({});
    const [athletes, setAthletes] = useState({});
    const [scores, setScores] = useState({});
    const [compName, setCompName] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        loadAll();
    }, [compId]);

    async function loadAll() {
        const snap = await get(ref(db, `competitions/${compId}`));
        if (!snap.exists()) return;
        const data = snap.val();
        setCompName(data.name || '');
        setCategories(data.categories || {});
        setAthletes(data.athletes || {});
        const resSnap = await get(ref(db, `competitions/${compId}/results`));
        setScores(resSnap.val() || {});
    }

    // ── Tek kategori için final oluştur ────────────────────────────────────
    async function createFinal(catId) {
        const cat = categories[catId];
        if (!cat) return;
        if (catId.endsWith('_final')) {
            toast('Bu zaten bir final kategorisi', 'warning');
            return;
        }
        const finalId = `${catId}_final`;
        if (categories[finalId]) {
            const ok = await confirm('Final Var', 'Bu kategorinin finali zaten var. Yenilemek istiyor musunuz?');
            if (!ok) return;
            await deleteFinalInternal(finalId);
        }

        setBusy(true);
        try {
            // Sporcuları topla
            const filtered = Object.values(athletes).filter(a =>
                (a.category === catId) || (a.categoryId === catId) || (a.catId === catId)
            );
            const rule = resolveCategoryRules(rules, cat).scoringRule;
            const ranked = filtered.map(a => {
                const res = scores[a.uniqueId] || scores[a.id] || {};
                // DNS/DNF → sıralama dışı; her iki serisi de geçersizse sporcu
                // hiç yarışmamış sayılır ve finale/yedeğe alınmaz.
                const { r1, r2, total } = computeRoutineTotals(res.r1, res.r2, rule);
                return { a, total, scored: r1 != null || r2 != null };
            }).filter(x => x.scored);
            ranked.sort((x, y) => y.total - x.total);

            const finalists = ranked.slice(0, rules.flow.finalistCount);
            const reserves = ranked.slice(rules.flow.finalistCount, rules.flow.finalistCount + rules.flow.reserveCount);

            if (finalists.length < 2) {
                toast('Yeterli sporcu yok (en az 2 sporcu gerekli)', 'error');
                return;
            }

            // A ve B gruplarını karıştır
            // Finalist sayısı kuraldan geldiği için gruplar ortadan bölünür
            const half = Math.ceil(finalists.length / 2);
            const groupA = finalists.slice(0, half).map(x => x.a);
            const groupB = finalists.slice(half).map(x => x.a);
            const shuffle = (arr) => {
                for (let i = arr.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                }
            };
            shuffle(groupA); shuffle(groupB);

            const orderedAthletes = [...groupA, ...groupB];

            const updates = {};

            // Önce finalist ve yedek sporcuları yaz, çıkış sırasını topla
            const orderIds = [];
            orderedAthletes.forEach((a, idx) => {
                const newUid = `${a.id}_final`;
                updates[`competitions/${compId}/athletes/${newUid}`] = {
                    ...a, id: newUid, uniqueId: newUid, originalId: a.id,
                    category: finalId, categoryId: finalId, catId: finalId,
                    isFinalist: true, isReserve: false,
                    startOrder: idx + 1,
                };
                orderIds.push(newUid);
            });
            reserves.forEach(({ a }, idx) => {
                const newUid = `${a.id}_final_res`;
                updates[`competitions/${compId}/athletes/${newUid}`] = {
                    ...a, id: newUid, uniqueId: newUid, originalId: a.id,
                    category: finalId, categoryId: finalId, catId: finalId,
                    isFinalist: true, isReserve: true,
                    startOrder: 100 + idx,
                };
                orderIds.push(newUid);
            });

            // Kategori nesnesi — startList İÇİNE yazılır.
            // Ayrı yol olarak yazılamaz: Firebase tek bir update() içinde bir
            // yolun başka bir yolun üstü olmasına izin vermiyor
            // (categories/{id} ile categories/{id}/startList çakışır).
            //
            // startList / athletes üst kategoriden MİRAS ALINMAMALI — aksi halde
            // CJP finalde eleme listesini eleme sırasıyla gösterir.
            const { startList: _ignoredStartList, athletes: _ignoredAthletes, ...catBase } = cat;
            updates[`competitions/${compId}/categories/${finalId}`] = {
                ...catBase,
                id: finalId,
                name: `${cat.name} — FİNAL`,
                isFinal: true,
                parentCategoryId: catId,
                createdAt: Date.now(),
                // CJP startOrder'ı değil startList'i okuyor; shuffle edilmiş
                // A/B sırası buradan gider.
                startList: orderIds.map((id, i) => ({ id, order: i + 1 })),
            };

            updates[`competitions/${compId}/startOrder/${finalId}`] = orderIds;

            await update(ref(db), updates);
            toast(`Final oluşturuldu: ${finalists.length} finalist + ${reserves.length} yedek`, 'success');
            await loadAll();
        } catch (e) {
            toast('Hata: ' + e.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    async function deleteFinalInternal(finalId) {
        const updates = {};
        // Finale bağlı sporcuları bul
        const finalAthletes = Object.values(athletes).filter(a =>
            (a.category === finalId) || (a.categoryId === finalId)
        );
        finalAthletes.forEach(a => {
            const uid = a.uniqueId || a.id;
            updates[`competitions/${compId}/athletes/${uid}`] = null;
        });
        updates[`competitions/${compId}/categories/${finalId}`] = null;
        updates[`competitions/${compId}/startOrder/${finalId}`] = null;
        await update(ref(db), updates);
    }

    async function deleteFinal(catId) {
        const ok = await confirm('Final Sil', 'Bu final kategorisini silmek istiyor musunuz?');
        if (!ok) return;
        setBusy(true);
        try {
            await deleteFinalInternal(catId);
            toast('Final silindi', 'info');
            await loadAll();
        } finally {
            setBusy(false);
        }
    }

    async function deleteAllFinals() {
        const finalCats = Object.keys(categories).filter(id => id.endsWith('_final'));
        if (finalCats.length === 0) {
            toast('Silinecek final yok', 'info');
            return;
        }
        const ok = await confirm('Tüm Finalleri Sil', `${finalCats.length} final kategorisi silinecek. Emin misiniz?`);
        if (!ok) return;
        setBusy(true);
        try {
            for (const id of finalCats) await deleteFinalInternal(id);
            toast('Tüm finaller silindi', 'info');
            await loadAll();
        } finally {
            setBusy(false);
        }
    }

    function athleteCount(catId) {
        return Object.values(athletes).filter(a =>
            (a.category === catId) || (a.categoryId === catId) || (a.catId === catId)
        ).length;
    }

    const catList = Object.values(categories);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                    <div>
                        <div style={{ color: 'white', fontWeight: 700 }}>{compName}</div>
                        <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>FİNAL OLUŞTURMA</div>
                    </div>
                </div>
                <button className="btn btn-outline btn-sm" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                    onClick={deleteAllFinals} disabled={busy}>
                    <i className="material-icons-round">delete_sweep</i> Tümünü Sil
                </button>
            </nav>

            <div className="container">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Kategoriler</h3>
                        <div className="text-muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>
                            İlk 8 finalist, 9-10 yedek olarak yerleştirilir. Finalistler A (1-4) ve B (5-8) gruplarına shuffle edilir.
                        </div>
                    </div>
                    <div className="card-body" style={{ padding: 0 }}>
                        <div className="table-responsive">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Kategori</th>
                                        <th style={{ width: 120, textAlign: 'center' }}>Sporcu</th>
                                        <th style={{ width: 120, textAlign: 'center' }}>Durum</th>
                                        <th style={{ width: 260 }}>İşlemler</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {catList.length === 0 && (
                                        <tr><td colSpan={4} className="text-center text-muted" style={{ padding: 40 }}>Kategori yok</td></tr>
                                    )}
                                    {catList.map(c => {
                                        const isFinal = c.id.endsWith('_final') || c.isFinal;
                                        const hasFinal = !isFinal && categories[`${c.id}_final`];
                                        return (
                                            <tr key={c.id}>
                                                <td>
                                                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                                                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{c.id}</div>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>{athleteCount(c.id)}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {isFinal ? (
                                                        <span style={{
                                                            padding: '2px 10px', borderRadius: 4, fontSize: '0.78rem',
                                                            background: 'rgba(253,185,49,0.15)', color: '#fbbf24', fontWeight: 700,
                                                        }}>FİNAL</span>
                                                    ) : hasFinal ? (
                                                        <span style={{
                                                            padding: '2px 10px', borderRadius: 4, fontSize: '0.78rem',
                                                            background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 700,
                                                        }}>FİNALİ VAR</span>
                                                    ) : (
                                                        <span style={{
                                                            padding: '2px 10px', borderRadius: 4, fontSize: '0.78rem',
                                                            background: 'rgba(148,163,184,0.15)', color: '#94a3b8',
                                                        }}>ELEME</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {isFinal ? (
                                                        <button className="btn btn-sm btn-outline"
                                                            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                                            disabled={busy}
                                                            onClick={() => deleteFinal(c.id)}>
                                                            <i className="material-icons-round">delete</i> Sil
                                                        </button>
                                                    ) : (
                                                        <button className="btn btn-sm btn-primary" disabled={busy}
                                                            onClick={() => createFinal(c.id)}>
                                                            <i className="material-icons-round">auto_awesome</i>
                                                            {hasFinal ? 'Yenile' : 'Final Oluştur'}
                                                        </button>
                                                    )}
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
    );
}
