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
import { jsPDF } from 'jspdf';

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
    const [compName, setCompName] = useState('');

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        (async () => {
            const [catSnap, compSnap] = await Promise.all([
                get(ref(db, `competitions/${compId}/categories`)),
                get(ref(db, `competitions/${compId}/name`)),
            ]);
            setCategories(catSnap.val() || {});
            setCompName(compSnap.val() || '');
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

    async function downloadPDF() {
        const dateStr = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });

        // ── Türkçe font yükle ───────────────────────────
        const toBase64 = buf => {
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
            return btoa(bin);
        };
        let fontLoaded = false;
        try {
            const [rResp, bResp] = await Promise.all([
                fetch('/fonts/Roboto-Regular.ttf'),
                fetch('/fonts/Roboto-Bold.ttf'),
            ]);
            const [rBuf, bBuf] = await Promise.all([rResp.arrayBuffer(), bResp.arrayBuffer()]);
            // font yükleme — jsPDF global VFS'e kaydedilecek
            window._pdfFontRegular = toBase64(rBuf);
            window._pdfFontBold    = toBase64(bBuf);
            fontLoaded = true;
        } catch (_) { /* font yoksa helvetica devam eder */ }

        // ── Veri hazırlama ──────────────────────────────
        // Tek kategori seçiliyse sadece o; seçili değilse tüm kategoriler
        let sections = []; // [{ catName, athletes }]

        if (selectedCatId) {
            // Mevcut ekrandaki listeyi kullan (zaten yüklü)
            sections = [{ catName: categories[selectedCatId]?.name || selectedCatId, athletes: athleteList }];
        } else {
            // Tüm kategorileri Firebase'den çek
            const catList = Object.values(categories).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
            if (catList.length === 0) { toast('Henüz kategori tanımlanmamış.', 'warning'); return; }

            const [athSnap, ...orderSnaps] = await Promise.all([
                get(ref(db, `competitions/${compId}/athletes`)),
                ...catList.map(c => get(ref(db, `competitions/${compId}/startOrder/${c.id}`))),
            ]);
            const athletesAll = athSnap.val() || {};

            catList.forEach((cat, idx) => {
                const filtered = Object.values(athletesAll)
                    .filter(a => (a.category === cat.id) || (a.categoryId === cat.id) || (a.catId === cat.id));
                if (filtered.length === 0) return; // sporcu yoksa atla

                const savedOrder = orderSnaps[idx].val();
                let ordered;
                if (Array.isArray(savedOrder) && savedOrder.length > 0) {
                    const mapById = {};
                    filtered.forEach(a => { mapById[a.id] = a; });
                    ordered = savedOrder.map(id => mapById[id]).filter(Boolean);
                    filtered.forEach(a => { if (!savedOrder.includes(a.id)) ordered.push(a); });
                } else {
                    ordered = [...filtered].sort((a, b) => {
                        const c = (a.club || '').localeCompare(b.club || '', 'tr');
                        return c !== 0 ? c : (a.surname || '').localeCompare(b.surname || '', 'tr');
                    });
                }
                sections.push({ catName: cat.name || cat.id, athletes: ordered });
            });

            if (sections.length === 0) { toast('Hiçbir kategoride sporcu bulunamadı.', 'warning'); return; }
        }

        // ── PDF oluştur ─────────────────────────────────
        const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        // Türkçe font kaydet
        const F_REG  = 'Roboto-Regular';
        const F_BOLD = 'Roboto-Bold';
        if (fontLoaded) {
            doc.addFileToVFS('Roboto-Regular.ttf', window._pdfFontRegular);
            doc.addFont('Roboto-Regular.ttf', F_REG, 'normal');
            doc.addFileToVFS('Roboto-Bold.ttf', window._pdfFontBold);
            doc.addFont('Roboto-Bold.ttf', F_BOLD, 'normal');
        }
        // Kısaltma: setFont'u sarmala
        const setNormal = () => doc.setFont(fontLoaded ? F_REG  : 'helvetica', 'normal');
        const setBold   = () => doc.setFont(fontLoaded ? F_BOLD : 'helvetica', 'bold');

        const pageW  = 210;
        const pageH  = 297;
        const mL     = 14;
        const mR     = 14;
        const cW     = pageW - mL - mR;
        const colNo  = 12;
        const colNm  = 85;
        const rowH   = 8;

        // ── Sayfa başı şablonu (ilk sayfa büyük header, sonrakiler küçük) ──
        function drawFirstHeader() {
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, pageW, 32, 'F');
            doc.setFillColor(56, 189, 248);
            doc.roundedRect(mL, 6, 20, 20, 2, 2, 'F');
            setBold(); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
            doc.text('TCF', mL + 10, 19, { align: 'center' });
            doc.setTextColor(255, 255, 255); doc.setFontSize(15);
            doc.text('CIKIS LISTESI', mL + 25, 14);
            setNormal(); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
            doc.text('Turkiye Cimnastik Federasyonu - Trambolin Sistemi', mL + 25, 21);
            doc.text(dateStr, pageW - mR, 14, { align: 'right' });
        }

        function drawContinuationHeader(label) {
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, pageW, 10, 'F');
            setBold(); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
            doc.text(`${compName ? compName + ' - ' : ''}${label}  (devam)`, mL, 7);
        }

        function drawTableHeader(y) {
            doc.setFillColor(241, 245, 249);
            doc.rect(mL, y, cW, rowH, 'F');
            setBold(); doc.setFontSize(8.5); doc.setTextColor(51, 65, 85);
            doc.text('NO',       mL + 4,              y + 5.5);
            doc.text('AD SOYAD', mL + colNo + 4,      y + 5.5);
            doc.text('KULUP',    mL + colNo + colNm + 4, y + 5.5);
            return y + rowH;
        }

        function drawFooter() {
            const n = doc.internal.getNumberOfPages();
            for (let i = 1; i <= n; i++) {
                doc.setPage(i);
                doc.setFillColor(241, 245, 249);
                doc.rect(0, pageH - 12, pageW, 12, 'F');
                setNormal(); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
                doc.text('TCF Trambolin Yarisma Yonetim Sistemi', mL, pageH - 5);
                doc.text(`Sayfa ${i} / ${n}   -   ${dateStr}`, pageW - mR, pageH - 5, { align: 'right' });
            }
        }

        // Türkçe karakterleri Roboto ile yaz; Roboto yoksa ASCII'ye çevir
        const tr = fontLoaded
            ? (s) => s   // Roboto → doğrudan yaz
            : (s) => (s || '').replace(/ğ/g,'g').replace(/Ğ/g,'G')
                           .replace(/ş/g,'s').replace(/Ş/g,'S')
                           .replace(/ı/g,'i').replace(/İ/g,'I')
                           .replace(/ö/g,'o').replace(/Ö/g,'O')
                           .replace(/ü/g,'u').replace(/Ü/g,'U')
                           .replace(/ç/g,'c').replace(/Ç/g,'C');

        // ── İçerik render ───────────────────────────────
        drawFirstHeader();
        let y = 42;

        // Yarışma adı (ilk sayfada)
        if (compName) {
            setBold(); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
            doc.text(tr(compName), mL, y); y += 8;
        }
        if (!selectedCatId) {
            setNormal(); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
            const total = sections.reduce((s, sec) => s + sec.athletes.length, 0);
            doc.text(tr(`Tum Kategoriler - ${sections.length} kategori, ${total} sporcu`), mL, y); y += 3;
            doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4);
            doc.line(mL, y, pageW - mR, y); y += 6;
        }

        sections.forEach((sec, sIdx) => {
            if (y + 28 > pageH - 18) {
                doc.addPage();
                drawContinuationHeader(tr(sec.catName));
                y = 16;
            }

            // Kategori başlık bandı
            doc.setFillColor(30, 41, 59);
            doc.rect(mL, y, cW, 10, 'F');
            setBold(); doc.setFontSize(9.5); doc.setTextColor(56, 189, 248);
            doc.text(tr(sec.catName.toUpperCase()), mL + 4, y + 7);
            setNormal(); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
            doc.text(`${sec.athletes.length} sporcu`, pageW - mR, y + 7, { align: 'right' });
            y += 12;

            y = drawTableHeader(y);

            sec.athletes.forEach((a, i) => {
                if (y + rowH > pageH - 18) {
                    doc.addPage();
                    drawContinuationHeader(tr(sec.catName));
                    y = 16;
                    y = drawTableHeader(y);
                }

                if (i % 2 === 0) {
                    doc.setFillColor(248, 250, 252);
                    doc.rect(mL, y, cW, rowH, 'F');
                }
                doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2);
                doc.line(mL, y + rowH, mL + cW, y + rowH);

                setBold(); doc.setFontSize(9); doc.setTextColor(30, 41, 59);
                doc.text(String(i + 1), mL + colNo / 2, y + 5.5, { align: 'center' });

                const fullName = tr(`${a.surname ? a.surname.toUpperCase() : ''} ${a.name || ''}`.trim());
                doc.text(fullName, mL + colNo + 4, y + 5.5);

                setNormal(); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
                doc.text(tr(a.club || '-'), mL + colNo + colNm + 4, y + 5.5);

                y += rowH;
            });

            if (sIdx < sections.length - 1) y += 8;
        });

        drawFooter();

        // ── Kaydet ──────────────────────────────────────
        const safeComp = (compName || 'yarışma').replace(/[^a-z0-9çşğüöıÇŞĞÜÖİ ]/gi, '');
        const safeSuffix = selectedCatId
            ? (categories[selectedCatId]?.name || selectedCatId).replace(/[^a-z0-9çşğüöıÇŞĞÜÖİ ]/gi, '')
            : 'tum-kategoriler';
        doc.save(`cikis-listesi_${safeComp}_${safeSuffix}.pdf`);
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
                        <button
                            className="btn btn-sm"
                            onClick={downloadPDF}
                            style={{ background: '#10b981', color: 'white' }}
                        >
                            <i className="material-icons-round">picture_as_pdf</i>
                            {selectedCatId ? 'PDF İndir' : 'Tümünü PDF İndir'}
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
