/**
 * CreateFinalsPage.jsx
 * Mevcut create_finals.html — Final kategorileri oluşturma.
 *
 * Mantık:
 *   - Her kategoride sporcular r1+r2 toplamına göre (veya senior için max) sıralanır.
 *   - İlk 8 finalist, 9-10 yedek seçilir.
 *   - Çıkış sırası TERS kurulur: elemede 5-8. sıradakiler ÖNCE (çıkış 1-4),
 *     elemede 1-4. sıradakiler SONRA (çıkış 5-8) yarışır. Her grup kendi
 *     içinde shuffle edilir; yani en iyi dört sporcu 5-8 arasında rastgele,
 *     diğer dördü 1-4 arasında rastgele yerleşir.
 *   - Yedekler (R1, R2) çıkış sırasının sonunda 9 ve 10. sırada yer alır.
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
import { getScoringRule, computeRoutineTotals, getAthleteName, getAthleteClub } from '../lib/DataService';
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

            // En az sporcu şartı yok — tek sporcuyla da final oluşturulabilir.
            // Yalnızca hiç puan almış sporcu yoksa oluşturulacak bir şey kalmaz.
            if (finalists.length === 0) {
                toast('Bu kategoride puan almış sporcu yok — final oluşturulamaz.', 'error');
                return;
            }

            // Gruplar: A = elemede üst yarı (1-4), B = alt yarı (5-8).
            // Finalist sayısı kuraldan geldiği için gruplar ortadan bölünür.
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

            // Çıkış sırası TERS: önce alt yarı (B → çıkış 1-4), sonra üst yarı
            // (A → çıkış 5-8). Böylece elemenin en iyi dördü en sonda yarışır.
            const orderedAthletes = [...groupB, ...groupA];

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
                    // Yedekler finalistlerin ardından: 9 ve 10. sıra
                    startOrder: orderedAthletes.length + idx + 1,
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

            // Yedek sayısı kuralın altındaysa nedenini söyle. Yedek ancak PUAN
            // ALMIŞ sporcudan seçilebilir; DNS/DNF veya hiç yarışmamış sporcular
            // sıralamaya girmediği için yedek eksik kalabiliyor.
            if (finalists.length >= rules.flow.finalistCount &&
                reserves.length < rules.flow.reserveCount) {
                const kayitli = filtered.length;
                toast(
                    `Yedek eksik: ${reserves.length}/${rules.flow.reserveCount}. ` +
                    `Bu kategoride ${kayitli} sporcu kayıtlı, ${ranked.length} tanesi puan aldı. ` +
                    `Yedek için ${rules.flow.finalistCount + rules.flow.reserveCount} puanlı sporcu gerekir.`,
                    'warning'
                );
            }
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

    /**
     * Final çıkış listesi — TCF logolu A4 PDF.
     * scope: 'all' → tüm final kategorileri, aksi halde tek kategori id'si.
     * Yedekler R1 / R2 olarak işaretlenir.
     */
    function printStartList(scope) {
        const finalCats = catList
            .filter(c => (c.isFinal || c.id.endsWith('_final')))
            .filter(c => scope === 'all' || c.id === scope);

        if (finalCats.length === 0) {
            toast('Yazdırılacak final kategorisi yok.', 'warning');
            return;
        }

        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));

        // Kategorinin çıkış sırası: startList varsa o, yoksa startOrder alanı
        function rowsOf(cat) {
            const catAths = Object.values(athletes).filter(a =>
                (a.category === cat.id) || (a.categoryId === cat.id) || (a.catId === cat.id)
            );
            const byId = {};
            catAths.forEach(a => { byId[a.uniqueId || a.id] = a; });

            let ordered;
            if (Array.isArray(cat.startList) && cat.startList.length) {
                ordered = cat.startList
                    .slice()
                    .sort((x, y) => (x.order || 0) - (y.order || 0))
                    .map(x => byId[x.id])
                    .filter(Boolean);
            } else {
                ordered = catAths.slice().sort((a, b) => (a.startOrder || 0) - (b.startOrder || 0));
            }

            // Yedekler sıranın sonunda: R1, R2 ...
            let resIdx = 0;
            return ordered.map((a, i) => ({
                order: i + 1,
                name: getAthleteName(a),
                club: getAthleteClub(a) || a.club || '',
                reserve: a.isReserve ? `R${++resIdx}` : '',
            }));
        }

        let body = '';
        finalCats.forEach(cat => {
            const rows = rowsOf(cat);
            if (rows.length === 0) return;
            const yedek = rows.filter(r => r.reserve).length;

            body += `
            <div class="page">
                <div class="header">
                    <img class="logo" src="${window.location.origin}/tcf-logo.png" alt="TCF" />
                    <div class="head-text">
                        <div class="comp-name">${esc(compName || '')}</div>
                        <h1 class="cat-name">${esc(cat.name)}</h1>
                        <div class="sub-header">FİNAL ÇIKIŞ LİSTESİ</div>
                    </div>
                </div>
                <div class="note">
                    ${rows.length - yedek} finalist${yedek ? ` · ${yedek} yedek (R1${yedek > 1 ? ', R2' : ''})` : ''}
                    · Çıkış sırası kura ile belirlenmiştir
                </div>
                <table>
                    <thead>
                        <tr>
                            <th class="c" style="width:64px">SIRA</th>
                            <th>AD SOYAD</th>
                            <th>KULÜP</th>
                            <th class="c" style="width:72px">YEDEK</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr class="${r.reserve ? 'res' : ''}">
                                <td class="rank-col">${r.order}</td>
                                <td class="name-col">${esc(r.name)}</td>
                                <td class="club-col">${esc(r.club || '—')}</td>
                                <td class="c res-col">${r.reserve || ''}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                <div class="footer">
                    <div>TCF TRAMBOLİN CİMNASTİK SİSTEMİ</div>
                    <div>Oluşturulma: ${new Date().toLocaleString('tr-TR')}</div>
                </div>
                <div class="signs">
                    <div class="sign"><span></span>Başhakem</div>
                    <div class="sign"><span></span>Üst Jüri</div>
                    <div class="sign"><span></span>Teknik Sorumlu</div>
                </div>
            </div>`;
        });

        if (!body) { toast('Yazdırılacak sporcu bulunamadı.', 'warning'); return; }

        const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>${esc(compName || 'Final')} — Çıkış Listesi</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  body { font-family:'Outfit',sans-serif; margin:0; color:#1e293b;
         -webkit-print-color-adjust:exact; print-color-adjust:exact; background:#e2e8f0; }
  .page { width:210mm; min-height:297mm; padding:12mm; margin:0 auto 10px; background:#fff;
          box-sizing:border-box; page-break-after:always; display:flex; flex-direction:column; }
  .page:last-child { page-break-after:auto; }

  .header { background:#E30613; color:#fff; padding:14px 18px; border-radius:12px;
            margin-bottom:18px; display:flex; align-items:center; gap:16px; }
  .logo { width:64px; height:64px; background:#fff; border-radius:50%; padding:4px; flex-shrink:0; object-fit:contain; }
  .head-text { text-align:left; min-width:0; }
  .comp-name { font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:1px; opacity:.95; }
  .cat-name  { font-size:26px; font-weight:900; margin:2px 0 0; }
  .sub-header{ font-size:12px; font-weight:700; letter-spacing:3px; opacity:.9; margin-top:2px; }

  .note { background:#f1f5f9; border-left:4px solid #E30613; padding:7px 12px; font-size:11px;
          color:#475569; font-weight:600; border-radius:0 6px 6px 0; margin-bottom:12px; }

  table { width:100%; border-collapse:collapse; font-size:12px; }
  thead th { background:#303868; color:#fff; padding:8px 10px; text-align:left;
             font-size:10px; letter-spacing:1px; font-weight:800; }
  thead th.c { text-align:center; }
  tbody td { padding:8px 10px; border-bottom:1px solid #e2e8f0; }
  tbody td.c { text-align:center; }
  tbody tr:nth-child(even) { background:#f8fafc; }
  .rank-col { text-align:center; font-family:'Space Mono',monospace; font-weight:800; font-size:14px; color:#303868; }
  .name-col { font-weight:700; }
  .club-col { color:#64748b; font-size:11px; }
  .res-col  { font-family:'Space Mono',monospace; font-weight:800; color:#E30613; }
  tbody tr.res { background:#fff7ed; }
  tbody tr.res .name-col { color:#9a3412; }

  .footer { margin-top:auto; padding-top:14px; border-top:1px solid #e2e8f0;
            display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; font-weight:500; }
  .signs { display:flex; justify-content:space-between; gap:24px; margin-top:26px; }
  .sign { flex:1; text-align:center; font-size:10px; color:#475569; font-weight:600; }
  .sign span { display:block; border-top:1px solid #94a3b8; margin-bottom:5px; height:34px; }

  @media print { body { background:#fff; } .page { margin:0; } }
</style></head>
<body>${body}<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;

        const w = window.open('', '_blank');
        if (!w) { toast('Açılır pencere engellendi — tarayıcı iznini kontrol edin.', 'error'); return; }
        w.document.write(html);
        w.document.close();
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
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm"
                        style={{ background: 'linear-gradient(135deg, #E02828, #A01C1C)', color: 'white' }}
                        onClick={() => printStartList('all')} disabled={busy}
                        title="Tüm final kategorilerinin çıkış listesi">
                        <i className="material-icons-round">picture_as_pdf</i> Çıkış Listesi — Tümü
                    </button>
                    <button className="btn btn-outline btn-sm" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                        onClick={deleteAllFinals} disabled={busy}>
                        <i className="material-icons-round">delete_sweep</i> Tümünü Sil
                    </button>
                </div>
            </nav>

            <div className="container">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Kategoriler</h3>
                        <div className="text-muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>
                            İlk 8 finalist, 9-10 yedek olarak yerleştirilir. Çıkış sırası ters kurulur:
                            elemede 5-8. sıradakiler 1-4 arasında, 1-4. sıradakiler 5-8 arasında rastgele
                            yerleşir. Yedekler (R1, R2) 9 ve 10. sırada yarışır.
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
                                                        <div style={{ display: 'flex', gap: 8 }}>
                                                            <button className="btn btn-sm"
                                                                style={{ background: 'linear-gradient(135deg, #E02828, #A01C1C)', color: 'white' }}
                                                                disabled={busy}
                                                                onClick={() => printStartList(c.id)}>
                                                                <i className="material-icons-round">picture_as_pdf</i> Çıkış Listesi
                                                            </button>
                                                            <button className="btn btn-sm btn-outline"
                                                                style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                                                disabled={busy}
                                                                onClick={() => deleteFinal(c.id)}>
                                                                <i className="material-icons-round">delete</i> Sil
                                                            </button>
                                                        </div>
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
