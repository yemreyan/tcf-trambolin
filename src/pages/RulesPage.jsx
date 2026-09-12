/**
 * RulesPage.jsx
 * Yarışma Kuralları — puanlama ve akışa ait tüm ayarlar tek ekrandan yönetilir.
 *
 * Kurallar competitions/{compId}/rules altında saklanır. Kaydedilmemiş bir alan
 * varsayılana düşer, yani kural tanımlanmamış yarışmalar bugünkü gibi çalışır.
 *
 * Puanlamaya dokunan alanlar ayrıca işaretlenir; kaydetmeden önce onay istenir.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { DEFAULT_RULES, mergeRules, saveRules, isChanged, resolveCategoryRules, saveCategoryRule } from '../lib/Rules';

export default function RulesPage() {
    const navigate = useNavigate();
    const { getActiveCompId } = useAuth();
    const { toast, confirm } = useNotification();

    const compId = getActiveCompId();

    const [compName, setCompName] = useState('');
    const [draft, setDraft]       = useState(() => mergeRules(null));
    const [saved, setSaved]       = useState(() => mergeRules(null));
    const [loading, setLoading]   = useState(true);
    const [busy, setBusy]         = useState(false);
    const [categories, setCategories] = useState({});

    useEffect(() => {
        if (!compId) { navigate('/'); return; }
        const unsubs = [];
        unsubs.push(onValue(ref(db, `competitions/${compId}/name`), s => setCompName(s.val() || '')));
        unsubs.push(onValue(ref(db, `competitions/${compId}/categories`), s => setCategories(s.val() || {})));
        unsubs.push(onValue(ref(db, `competitions/${compId}/rules`), s => {
            const merged = mergeRules(s.val());
            setSaved(merged);
            // Kullanıcı düzenleme yapmadıysa taslağı da tazele
            setDraft(prev => (loading ? merged : prev));
            setLoading(false);
        }));
        return () => unsubs.forEach(u => u && u());
    }, [compId]);

    const set = (group, key, value) =>
        setDraft(d => ({ ...d, [group]: { ...d[group], [key]: value } }));

    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

    // Puanlamayı etkileyen gruplar
    const scoringTouched =
        JSON.stringify(draft.scoring) !== JSON.stringify(saved.scoring) ||
        JSON.stringify(draft.judgeInput) !== JSON.stringify(saved.judgeInput);

    async function handleSave() {
        if (!dirty) return;
        if (scoringTouched) {
            const ok = await confirm(
                'Puanlama Kuralları Değişiyor',
                'Değiştirdiğiniz alanlar puan hesabını doğrudan etkiliyor.\n\n' +
                'Devam eden bir yarışma varsa bundan sonra hesaplanan tüm puanlar ' +
                'yeni kurala göre çıkar; daha önce yayınlanmış sonuçlar değişmez.\n\n' +
                'Kaydedilsin mi?'
            );
            if (!ok) return;
        }
        setBusy(true);
        try {
            await saveRules(compId, draft);
            toast('Kurallar kaydedildi', 'success');
        } catch (e) {
            toast('Kaydedilemedi: ' + e.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    async function handleResetAll() {
        const ok = await confirm(
            'Varsayılanlara Dön',
            'Tüm kurallar fabrika değerlerine döndürülecek. Kaydedilmiş özel ayarlar kaybolur. Devam?'
        );
        if (!ok) return;
        setDraft(mergeRules(null));
        toast('Varsayılanlar yüklendi — kaydetmeyi unutmayın', 'info');
    }

    if (loading) {
        return <div style={{ padding: 40, color: '#94a3b8' }}>Yükleniyor…</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <nav className="topnav">
                <div className="brand">
                    <div className="brand-title">TCF</div>
                    <div className="brand-subtitle">YARIŞMA KURALLARI</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {dirty && (
                        <span style={{
                            background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.4)',
                            color: '#eab308', padding: '4px 12px', borderRadius: 6,
                            fontSize: '0.78rem', fontWeight: 700,
                        }}>
                            Kaydedilmemiş değişiklik
                        </span>
                    )}
                    <button className="btn btn-sm" disabled={!dirty || busy}
                        style={{
                            background: dirty ? '#10b981' : 'rgba(255,255,255,0.1)',
                            color: 'white', opacity: dirty ? 1 : 0.5,
                            cursor: dirty && !busy ? 'pointer' : 'not-allowed',
                        }}
                        onClick={handleSave}>
                        <i className="material-icons-round">save</i> {busy ? 'Kaydediliyor…' : 'Kaydet'}
                    </button>
                    <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                        onClick={() => navigate('/panel')}>
                        <i className="material-icons-round">arrow_back</i> Panel
                    </button>
                </div>
            </nav>

            <div className="container" style={{ maxWidth: 1000 }}>
                <div style={{ color: '#94a3b8', marginBottom: 6, fontSize: '0.85rem' }}>AKTİF YARIŞMA</div>
                <h2 style={{ color: 'var(--accent-primary)', marginTop: 0, marginBottom: 4 }}>{compName || '—'}</h2>
                <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 0, marginBottom: 20 }}>
                    Bu kurallar yalnızca bu yarışma için geçerlidir. Değiştirilmeyen alanlar
                    varsayılan değerle çalışır. <strong style={{ color: '#f59e0b' }}>Turuncu</strong> işaretli
                    alanlar varsayılandan farklıdır.
                </p>

                {/* ── Puanlama ────────────────────────────────────────────── */}
                <Section
                    title="Puanlama Formülü ve Eleme"
                    icon="calculate"
                    accent="#E02828"
                    warn="Bu alanlar puan hesabını doğrudan değiştirir."
                >
                    <NumField g="scoring" k="eJudgeCount" label="E hakem sayısı"
                        hint="Kaç icra hakeminin notu okunur (e1…eN)"
                        min={1} max={6} step={1} draft={draft} set={set} />
                    <NumField g="scoring" k="trimHigh" label="Elenen en yüksek not sayısı"
                        hint="Her elemanda atılacak yüksek uç sayısı" min={0} max={3} step={1} draft={draft} set={set} />
                    <NumField g="scoring" k="trimLow" label="Elenen en düşük not sayısı"
                        hint="Her elemanda atılacak düşük uç sayısı" min={0} max={3} step={1} draft={draft} set={set} />
                    <NumField g="scoring" k="minJudgesForTrim" label="Eleme için gereken en az not"
                        hint="Bu sayının altında not varsa eleme yapılmaz" min={1} max={6} step={1} draft={draft} set={set} />
                    <NumField g="scoring" k="basePerElementIndividual" label="Bireysel taban çarpanı"
                        hint="Taban puan = hareket sayısı × bu değer (10 hareket × 2 = 20.0)"
                        min={0} max={5} step={0.5} draft={draft} set={set} />
                    <NumField g="scoring" k="basePerElementSync" label="Senkron taban çarpanı"
                        hint="Senkron taban = hareket sayısı × bu değer (10 × 1 = 10.0)"
                        min={0} max={5} step={0.5} draft={draft} set={set} />
                    <NumField g="scoring" k="syncSMultiplier" label="Senkron S çarpanı"
                        hint="Senkron toplamda S değeri bu katsayıyla eklenir" min={0} max={5} step={0.5} draft={draft} set={set} />
                </Section>

                {/* ── Hakem girişi ───────────────────────────────────────── */}
                <Section
                    title="Hakem Giriş Seçenekleri"
                    icon="gavel"
                    accent="#3b82f6"
                    warn="Hakem ekranındaki tuşları ve kutu sayısını belirler."
                >
                    <ListField g="judgeInput" k="deductOptions" label="Kesinti seçenekleri"
                        hint="E hakeminin bir harekete verebileceği değerler (virgülle ayır)"
                        draft={draft} set={set} />
                    <ListField g="judgeInput" k="landingOptions" label="İniş seçenekleri"
                        hint="İniş (L) kutusunda geçerli değerler" draft={draft} set={set} />
                    <NumField g="judgeInput" k="maxElements" label="Bir seride en fazla hareket"
                        hint="Hakem ekranındaki kutu sayısının üst sınırı" min={1} max={20} step={1} draft={draft} set={set} />
                    <NumField g="judgeInput" k="landingMinElements" label="İnişin puanlandığı en az hareket"
                        hint="Hareket sayısı bunun altındaysa L kutusu hiç gösterilmez"
                        min={1} max={20} step={1} draft={draft} set={set} />
                    <ListField g="judgeInput" k="dQuickValues" label="D hızlı seçim değerleri"
                        hint="Zorluk hakeminin ekranındaki hazır butonlar" draft={draft} set={set} />
                </Section>

                {/* ── Akış ───────────────────────────────────────────────── */}
                <Section title="Yarışma Akışı" icon="emoji_events" accent="#10b981">
                    <SelectField g="flow" k="defaultScoringRule" label="Varsayılan seri toplama"
                        hint="Kategoriye özel kural yoksa uygulanır"
                        options={[['sum', 'Toplam (R1 + R2)'], ['max', 'En iyisi (MAX)']]}
                        draft={draft} set={set} />
                    <ListField g="flow" k="maxRuleKeywords" label="MAX kuralı anahtar kelimeleri"
                        hint="Kategori adında bunlardan biri geçerse otomatik MAX uygulanır"
                        text draft={draft} set={set} />
                    <NumField g="flow" k="finalistCount" label="Finalist sayısı"
                        hint="Finale kalan sporcu/çift sayısı" min={2} max={24} step={1} draft={draft} set={set} />
                    <NumField g="flow" k="reserveCount" label="Yedek sayısı"
                        hint="Finalistlerin ardından yedek olarak eklenecek sayı" min={0} max={10} step={1} draft={draft} set={set} />
                    <NumField g="flow" k="teamTopN" label="Takım puanına sayılan sporcu"
                        hint="Kulüp sıralamasında en iyi kaç sporcunun puanı toplanır" min={1} max={10} step={1} draft={draft} set={set} />
                    <NumField g="flow" k="teamMinAthletes" label="Takım için en az sporcu"
                        hint="Kulüpte bu kadar sporcu yoksa takım listesine hiç girmez"
                        min={1} max={10} step={1} draft={draft} set={set} />
                    <KeywordMinField g="flow" k="teamMinByKeyword" label="Kategoriye göre takım eşiği"
                        hint="Kategori adında anahtar kelime geçiyorsa bu eşik uygulanır (senkron kategorilerde uygulanmaz). Biçim: kelime=sayı, virgülle ayır."
                        draft={draft} set={set} />
                    <SelectField g="flow" k="teamMode" label="Takım puanı yöntemi"
                        hint="Sporcu toplamı: en iyi N sporcunun genel toplamı. Seri bazlı: her serinin en iyi N puanı ayrı seçilip toplanır."
                        options={[['athleteTotal', 'Sporcu toplamı (en iyi N sporcu)'], ['perRoutine', 'Seri bazlı (her serinin en iyi N puanı)']]}
                        draft={draft} set={set} />
                    <NumField g="flow" k="teamPerRoutineMinAthletes" label="Seri bazlı için en az sporcu"
                        hint="Kulüpte bu kadar sporcu varsa seri bazlı hesaplanır; altındaysa sporcu toplamına düşülür"
                        min={1} max={12} step={1} draft={draft} set={set} />
                    <SelectField g="flow" k="routineCount" label="Varsayılan seri sayısı"
                        hint="Kategoride ayrı belirtilmezse geçerli olur"
                        options={[[1, 'Tek seri'], [2, 'İki seri']]} numeric draft={draft} set={set} />
                    <BoolField g="flow" k="hasDScore" label="Zorluk (D) puanı kullanılıyor"
                        hint="Kapalıysa D puanı toplama girmez ve başhakemde gösterilmez" draft={draft} set={set} />
                    <BoolField g="flow" k="hasTeam" label="Takım sıralaması yapılıyor"
                        hint="Kapalıysa takım sekmesi boş kalır" draft={draft} set={set} />
                    <SelectField g="flow" k="finalTeamSource" label="Finalde takım puanı kaynağı"
                        hint="Finalde kulüp başına 1-2 sporcu kaldığı için takım kurulamaz. Varsayılan: takım sıralaması eleme sonuçlarından alınır."
                        options={[
                            ['qualification', 'Eleme sonuçlarından (önerilen)'],
                            ['final', 'Finaldeki puanlardan'],
                            ['none', 'Finalde takım gösterme'],
                        ]}
                        draft={draft} set={set} />
                </Section>

                {/* ── Ekran / oturum ─────────────────────────────────────── */}
                {/* ── Kategori bazlı ─────────────────────────────────────── */}
                <Section
                    title="Kategori Bazlı Kurallar"
                    icon="category"
                    accent="#c084fc"
                    warn="Burada yapılan değişiklik ANINDA kaydedilir; yukarıdaki Kaydet düğmesini beklemez."
                >
                    <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 0 }}>
                        Boş bırakılan (Devral) alanlarda yukarıdaki yarışma geneli kural geçerlidir.
                    </p>
                    {Object.keys(categories).length === 0 ? (
                        <div style={{ color: '#475569', padding: '10px 0' }}>Bu yarışmada kategori tanımlı değil.</div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                                <thead>
                                    <tr style={{ color: '#64748b', fontSize: '0.72rem', letterSpacing: 1 }}>
                                        <th style={catTh}>KATEGORİ</th>
                                        <th style={catTh}>SERİ TOPLAMA</th>
                                        <th style={catTh}>SERİ SAYISI</th>
                                        <th style={catTh}>D PUANI</th>
                                        <th style={catTh}>TAKIM</th>
                                        <th style={catTh}>TAKIM YÖNTEMİ</th>
                                        <th style={catTh}>EN AZ SPORCU</th>
                                        <th style={catTh}>FİNALDE TAKIM</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.values(categories).map(cat => {
                                        const eff = resolveCategoryRules(draft, cat);
                                        const own = cat.rules || {};
                                        return (
                                            <tr key={cat.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                <td style={{ ...catTd, fontWeight: 600, color: '#e2e8f0' }}>
                                                    {cat.name}
                                                    {cat.type === 'sync' && (
                                                        <span style={{ color: '#c084fc', fontSize: '0.7rem', marginLeft: 6 }}>SENKRON</span>
                                                    )}
                                                    {cat.isFinal && (
                                                        <span style={{ color: '#E02828', fontSize: '0.7rem', marginLeft: 6 }}>FİNAL</span>
                                                    )}
                                                </td>
                                                <CatCell compId={compId} catId={cat.id} k="scoringRule" own={own} eff={eff.scoringRule}
                                                    options={[['sum', 'Toplam'], ['max', 'En iyisi']]} toast={toast} />
                                                <CatCell compId={compId} catId={cat.id} k="routineCount" own={own} eff={eff.routineCount}
                                                    options={[[1, 'Tek seri'], [2, 'İki seri']]} numeric toast={toast} />
                                                <CatCell compId={compId} catId={cat.id} k="hasDScore" own={own} eff={eff.hasDScore}
                                                    options={[[true, 'Var'], [false, 'Yok']]} bool toast={toast} />
                                                <CatCell compId={compId} catId={cat.id} k="hasTeam" own={own} eff={eff.hasTeam}
                                                    options={[[true, 'Var'], [false, 'Yok']]} bool toast={toast} />
                                                <CatCell compId={compId} catId={cat.id} k="teamMode" own={own} eff={eff.teamMode}
                                                    options={[['athleteTotal', 'Sporcu toplamı'], ['perRoutine', 'Seri bazlı']]} toast={toast} />
                                                <CatCell compId={compId} catId={cat.id} k="teamMinAthletes" own={own} eff={eff.teamMinAthletes}
                                                    options={[[1,'1'],[2,'2'],[3,'3'],[4,'4'],[5,'5'],[6,'6']]} numeric toast={toast} />
                                                <CatCell compId={compId} catId={cat.id} k="finalTeamSource" own={own} eff={eff.finalTeamSource}
                                                    options={[['qualification', 'Elemeden'], ['final', 'Finalden'], ['none', 'Gösterme']]} toast={toast} />
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Section>

                <Section title="Ekran ve Oturum" icon="settings" accent="#8b5cf6">
                    <NumField g="session" k="inactivityMinutes" label="Ekran kilidi süresi (dakika)"
                        hint="Hakem/başhakem ekranı bu süre dokunulmazsa kilitlenir. Şifre tanımlı değilse kilit çalışmaz."
                        min={1} max={240} step={1} draft={draft} set={set} />
                    <NumField g="session" k="liveCycleSeconds" label="Canlı sonuç döngüsü (saniye)"
                        hint="TV ekranında kategori/sayfa değişim aralığı" min={2} max={120} step={1} draft={draft} set={set} />
                    <NumField g="session" k="athletesPerPage" label="Canlı sonuçta sayfa başına satır"
                        hint="TV ekranında bir sayfada gösterilen sporcu sayısı" min={3} max={30} step={1} draft={draft} set={set} />
                    <NumField g="session" k="teamsPerPage" label="Canlı sonuçta sayfa başına takım"
                        hint="Takım kartları daha yüksektir; ekrana sığacak sayıyı seçin" min={1} max={8} step={1} draft={draft} set={set} />
                </Section>

                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '24px 0 40px', gap: 12, flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={handleResetAll}>
                        <i className="material-icons-round">restart_alt</i> Tümünü varsayılana döndür
                    </button>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-outline btn-sm" disabled={!dirty}
                            onClick={() => setDraft(saved)}>
                            Değişiklikleri geri al
                        </button>
                        <button className="btn btn-sm" disabled={!dirty || busy}
                            style={{
                                background: dirty ? '#10b981' : 'rgba(255,255,255,0.1)', color: 'white',
                                opacity: dirty ? 1 : 0.5,
                            }}
                            onClick={handleSave}>
                            <i className="material-icons-round">save</i> Kaydet
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── Bölüm ──────────────────────────────────────────────────────────────── */
function Section({ title, icon, accent, warn, children }) {
    return (
        <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="material-icons-round" style={{ color: accent }}>{icon}</i>
                <h3 className="card-title" style={{ margin: 0 }}>{title}</h3>
            </div>
            <div className="card-body">
                {warn && (
                    <div style={{
                        background: 'rgba(224,40,40,0.1)', border: '1px solid rgba(224,40,40,0.3)',
                        color: '#fca5a5', borderRadius: 8, padding: '8px 12px',
                        fontSize: '0.8rem', marginBottom: 14,
                    }}>
                        <i className="material-icons-round" style={{ fontSize: '1rem', verticalAlign: 'middle', marginRight: 6 }}>warning</i>
                        {warn}
                    </div>
                )}
                {children}
            </div>
        </div>
    );
}

/* ── Alan sarmalayıcı ───────────────────────────────────────────────────── */
function Field({ label, hint, changed, defaultValue, onReset, children }) {
    return (
        <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(200px, 1.3fr) minmax(160px, 1fr)',
            gap: 14, alignItems: 'start', padding: '11px 0',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
            <div>
                <div style={{ fontWeight: 600, color: changed ? '#f59e0b' : '#e2e8f0', fontSize: '0.92rem' }}>
                    {label}
                    {changed && (
                        <button onClick={onReset} title={`Varsayılan: ${defaultValue}`}
                            style={{
                                marginLeft: 8, background: 'none', border: 'none',
                                color: '#64748b', cursor: 'pointer', fontSize: '0.72rem',
                                textDecoration: 'underline', padding: 0,
                            }}>
                            varsayılana dön
                        </button>
                    )}
                </div>
                {hint && <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 3 }}>{hint}</div>}
            </div>
            <div>{children}</div>
        </div>
    );
}

const inputStyle = {
    width: '100%', background: 'rgba(0,0,0,0.3)', color: 'white',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
    padding: '8px 12px', fontSize: '0.9rem', boxSizing: 'border-box',
    fontFamily: "'Outfit', sans-serif",
};

function NumField({ g, k, label, hint, min, max, step, draft, set }) {
    const value = draft[g][k];
    const changed = isChanged(g, k, value);
    return (
        <Field label={label} hint={hint} changed={changed}
            defaultValue={DEFAULT_RULES[g][k]}
            onReset={() => set(g, k, DEFAULT_RULES[g][k])}>
            <input
                type="number" min={min} max={max} step={step} value={value}
                onChange={e => {
                    const v = e.target.value === '' ? '' : Number(e.target.value);
                    set(g, k, v);
                }}
                onBlur={e => {
                    // Boş veya aralık dışı bırakılmasın
                    let v = Number(e.target.value);
                    if (!Number.isFinite(v)) v = DEFAULT_RULES[g][k];
                    if (min != null) v = Math.max(min, v);
                    if (max != null) v = Math.min(max, v);
                    set(g, k, v);
                }}
                style={{ ...inputStyle, borderColor: changed ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.15)' }}
            />
        </Field>
    );
}

function SelectField({ g, k, label, hint, options, draft, set, numeric }) {
    const value = draft[g][k];
    const changed = isChanged(g, k, value);
    return (
        <Field label={label} hint={hint} changed={changed}
            defaultValue={DEFAULT_RULES[g][k]}
            onReset={() => set(g, k, DEFAULT_RULES[g][k])}>
            <select value={value} onChange={e => set(g, k, numeric ? Number(e.target.value) : e.target.value)}
                style={{ ...inputStyle, borderColor: changed ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.15)' }}>
                {options.map(([v, l]) => (
                    <option key={v} value={v} style={{ background: '#1e293b' }}>{l}</option>
                ))}
            </select>
        </Field>
    );
}

function BoolField({ g, k, label, hint, draft, set }) {
    const value = draft[g][k] !== false;
    const changed = isChanged(g, k, value);
    return (
        <Field label={label} hint={hint} changed={changed}
            defaultValue={DEFAULT_RULES[g][k] ? 'Açık' : 'Kapalı'}
            onReset={() => set(g, k, DEFAULT_RULES[g][k])}>
            <select value={value ? 'on' : 'off'} onChange={e => set(g, k, e.target.value === 'on')}
                style={{ ...inputStyle, borderColor: changed ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.15)' }}>
                <option value="on"  style={{ background: '#1e293b' }}>Açık</option>
                <option value="off" style={{ background: '#1e293b' }}>Kapalı</option>
            </select>
        </Field>
    );
}

/** "kelime=sayı" çiftleri. Örn: "genç=2, büyük=2" */
function KeywordMinField({ g, k, label, hint, draft, set }) {
    const value = draft[g][k] || [];
    const changed = isChanged(g, k, value);
    const [raw, setRaw] = useState(null);
    const toText = (arr) => (arr || []).map(x => `${x.keyword}=${x.min}`).join(', ');
    const shown = raw !== null ? raw : toText(value);

    const parse = (str) => str.split(',').map(p => p.trim()).filter(Boolean).map(p => {
        const [kw, mn] = p.split('=');
        return { keyword: (kw || '').trim(), min: Number(mn) || 3 };
    }).filter(x => x.keyword);

    return (
        <Field label={label} hint={hint} changed={changed}
            defaultValue={toText(DEFAULT_RULES[g][k])}
            onReset={() => { setRaw(null); set(g, k, DEFAULT_RULES[g][k]); }}>
            <input
                type="text" value={shown}
                onChange={e => { setRaw(e.target.value); set(g, k, parse(e.target.value)); }}
                onBlur={() => setRaw(null)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="genç=2, büyük=2"
                style={{ ...inputStyle, borderColor: changed ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.15)' }}
            />
        </Field>
    );
}

/** Virgülle ayrılmış liste. `text` verilmezse sayıya çevrilir ve sıralanır. */
function ListField({ g, k, label, hint, draft, set, text }) {
    const value = draft[g][k] || [];
    const changed = isChanged(g, k, value);
    const [raw, setRaw] = useState(null); // düzenleme sırasında ham metin

    const shown = raw !== null ? raw : value.join(', ');

    // Taslağa HER değişiklikte yazılır. Yalnızca blur'da işlenseydi, kullanıcı
    // alandan çıkmadan doğrudan Kaydet'e bastığında değişiklik kaybolurdu.
    // `raw` yalnızca görüntü içindir; virgül yazarken metin bozulmasın diye.
    const parse = (str) => {
        const parts = str.split(',').map(x => x.trim()).filter(Boolean);
        if (text) return parts;
        const nums = parts.map(Number).filter(n => Number.isFinite(n));
        return [...new Set(nums)].sort((a, b) => a - b);
    };

    return (
        <Field label={label} hint={hint} changed={changed}
            defaultValue={(DEFAULT_RULES[g][k] || []).join(', ')}
            onReset={() => { setRaw(null); set(g, k, DEFAULT_RULES[g][k]); }}>
            <input
                type="text" value={shown}
                onChange={e => { setRaw(e.target.value); set(g, k, parse(e.target.value)); }}
                onBlur={() => setRaw(null)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="0, 0.1, 0.2"
                style={{ ...inputStyle, borderColor: changed ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.15)' }}
            />
        </Field>
    );
}

/* ── Kategori tablosu ────────────────────────────────────────────────────── */
const catTh = { textAlign: 'left', padding: '8px 10px', fontWeight: 700 };
const catTd = { padding: '8px 10px', fontSize: '0.85rem' };

/**
 * Kategori kuralı hücresi. "Devral" seçilirse alan silinir ve yarışma geneli
 * kural geçerli olur; parantez içinde o an geçerli değer gösterilir.
 */
function CatCell({ compId, catId, k, own, eff, options, numeric, bool, toast }) {
    const raw = own[k];
    const isInherited = raw === undefined || raw === null || raw === '';
    const current = isInherited ? '' : String(raw);

    const effLabel = (() => {
        const hit = options.find(([v]) => String(v) === String(eff));
        return hit ? hit[1] : String(eff);
    })();

    async function change(v) {
        let value = null;                       // '' → devral (alanı sil)
        if (v !== '') {
            if (bool) value = v === 'true';
            else if (numeric) value = Number(v);
            else value = v;
        }
        try {
            await saveCategoryRule(compId, catId, k, value);
        } catch (e) {
            toast('Kaydedilemedi: ' + e.message, 'error');
        }
    }

    return (
        <td style={catTd}>
            <select
                value={current}
                onChange={e => change(e.target.value)}
                style={{
                    ...inputStyle, padding: '6px 8px', fontSize: '0.82rem',
                    borderColor: isInherited ? 'rgba(255,255,255,0.12)' : 'rgba(192,132,252,0.5)',
                    color: isInherited ? '#94a3b8' : '#fff',
                }}
            >
                <option value="" style={{ background: '#1e293b' }}>Devral ({effLabel})</option>
                {options.map(([v, l]) => (
                    <option key={String(v)} value={String(v)} style={{ background: '#1e293b' }}>{l}</option>
                ))}
            </select>
        </td>
    );
}
