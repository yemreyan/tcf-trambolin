/**
 * Rules.js
 * Yarışma kuralları — tek kaynak.
 *
 * Kurallar competitions/{compId}/rules altında saklanır. Kayıt yoksa veya bir
 * alan eksikse DEFAULT_RULES devreye girer; bu değerler kuralların koda gömülü
 * olduğu dönemdeki değerlerin birebir aynısıdır. Yani kural tanımlanmamış eski
 * yarışmalar bugünkü gibi hesaplanmaya devam eder.
 *
 * DİKKAT: scoring/judgeInput alanları canlı puanlamayı doğrudan etkiler.
 */

import { useState, useEffect } from 'react';
import { ref, onValue, get, update } from 'firebase/database';
import { db } from './firebase';

export const DEFAULT_RULES = {
    // ── Puanlama formülü ve eleme ─────────────────────────────────────────
    scoring: {
        eJudgeCount: 6,                 // kaç E hakemi okunur (e1..eN)
        trimHigh: 2,                    // her elemanda atılacak en yüksek not sayısı
        trimLow: 2,                     // her elemanda atılacak en düşük not sayısı
        minJudgesForTrim: 6,            // bu sayının altında eleme yapılmaz
        basePerElementIndividual: 2,    // bireysel taban = eleman × 2
        basePerElementSync: 1,          // senkron taban  = eleman × 1
        syncSMultiplier: 2,             // senkron toplamda S × 2
    },

    // ── Hakem giriş seçenekleri ───────────────────────────────────────────
    judgeInput: {
        deductOptions: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        landingOptions: [0, 0.1, 0.2, 0.3, 0.5, 1.0],
        maxElements: 10,                // bir seride en fazla hareket
        landingMinElements: 10,         // iniş bu hareket sayısı ve üstünde puanlanır
        dQuickValues: [7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5],
    },

    // ── Yarışma akışı ─────────────────────────────────────────────────────
    flow: {
        defaultScoringRule: 'sum',      // 'sum' (R1+R2) | 'max' (en iyisi)
        routineCount: 2,                // kategori başına seri sayısı (1 veya 2)
        hasDScore: true,                // zorluk (D) puanı kullanılıyor mu
        hasTeam: true,                  // takım sıralamasına giriyor mu (senkron hariç)
        maxRuleKeywords: ['buyuk', 'büyük', '17+', '17_yas', 'senior', 'buyukler', 'büyükler', '21+'],
        finalistCount: 8,
        reserveCount: 2,
        teamTopN: 3,                    // takım puanına sayılan sporcu sayısı
        // Bir kulübün takım sayılabilmesi için gereken en az sporcu.
        // Altında kalan kulüpler takım listesinde HİÇ görünmez.
        teamMinAthletes: 3,
        // Bazı yaş kategorilerinde takım daha az sporcuyla kurulur.
        // Kategori adında anahtar kelime geçiyorsa ve kategori SENKRON
        // DEĞİLSE bu eşik uygulanır. Kategoride açık ayar varsa o kazanır.
        teamMinByKeyword: [
            { keyword: 'genç',  min: 2 },
            { keyword: 'genc',  min: 2 },
            { keyword: 'büyük', min: 2 },
            { keyword: 'buyuk', min: 2 },
        ],
        // Takım puanı nasıl hesaplanır:
        //  'athleteTotal' → en iyi N sporcunun GENEL toplamı (mevcut davranış)
        //  'perRoutine'   → her serinin en iyi N puanı ayrı ayrı toplanır
        //                   (1. serinin en iyi 3'ü + 2. serinin en iyi 3'ü)
        teamMode: 'athleteTotal',
        // perRoutine yalnızca kulüpte bu kadar sporcu varsa uygulanır;
        // altındaysa athleteTotal'a düşülür.
        teamPerRoutineMinAthletes: 4,
    },

    // ── Ekran ve oturum ───────────────────────────────────────────────────
    session: {
        inactivityMinutes: 10,
        liveCycleSeconds: 8,            // canlı sonuç ekranı sayfa döngüsü
        athletesPerPage: 10,            // canlı sonuçta sayfa başına satır
        // Takım kartları bireysel satırlardan yüksek; TV'de kaydırma olmaması
        // için sayfa başına daha az gösterilir.
        teamsPerPage: 3,
    },
};

/** Kayıtlı kuralları varsayılanlarla birleştirir (alan bazında, derin). */
export function mergeRules(stored) {
    const out = {};
    for (const [group, defaults] of Object.entries(DEFAULT_RULES)) {
        out[group] = { ...defaults, ...(stored?.[group] || {}) };
    }
    return out;
}

/** Yarışmanın kurallarını canlı dinler. compId yoksa varsayılanları döner. */
export function useRules(compId) {
    const [rules, setRules] = useState(() => mergeRules(null));
    useEffect(() => {
        if (!compId) { setRules(mergeRules(null)); return; }
        const unsub = onValue(ref(db, `competitions/${compId}/rules`), snap => {
            setRules(mergeRules(snap.val()));
        });
        return () => unsub();
    }, [compId]);
    return rules;
}

export async function loadRules(compId) {
    if (!compId) return mergeRules(null);
    try {
        const snap = await get(ref(db, `competitions/${compId}/rules`));
        return mergeRules(snap.val());
    } catch {
        return mergeRules(null);
    }
}

export async function saveRules(compId, rules) {
    if (!compId) throw new Error('Yarışma seçilmemiş');
    await update(ref(db, `competitions/${compId}/rules`), rules);
}

/** Tek bir alanın varsayılandan farklı olup olmadığını söyler (arayüz işareti için). */
export function isChanged(group, key, value) {
    const def = DEFAULT_RULES[group]?.[key];
    return JSON.stringify(def) !== JSON.stringify(value);
}

// ── Kategori bazlı kurallar ───────────────────────────────────────────────
// competitions/{compId}/categories/{catId}/rules altında saklanır.
// Alan yoksa veya null ise yarışma geneli kural geçerlidir ("devral").
export const CATEGORY_RULE_FIELDS = {
    scoringRule:  { label: 'Seri toplama',   hint: 'Toplam (R1+R2) mi, en iyisi mi' },
    routineCount: { label: 'Seri sayısı',    hint: 'Bu kategoride kaç seri yapılır' },
    hasDScore:    { label: 'Zorluk (D) puanı', hint: 'Kapalıysa D puanı hiç sorulmaz ve toplama girmez' },
    hasTeam:      { label: 'Takım sıralaması', hint: 'Kapalıysa bu kategori takım puanına girmez' },
    teamMode:     { label: 'Takım puanı yöntemi', hint: 'Sporcu toplamı mı, seri bazlı en iyiler mi' },
    teamMinAthletes: { label: 'Takım için en az sporcu', hint: 'Kulüpte bu kadar sporcu yoksa takım listesine girmez' },
    teamPerRoutineMinAthletes: { label: 'Seri bazlı için en az sporcu', hint: 'Kulüpte bu kadar sporcu varsa seri bazlı hesaplanır' },
};

/**
 * Bir kategori için geçerli kuralları çözer.
 * Kategoride tanımlı olan kazanır; tanımlı değilse yarışma geneli kullanılır.
 *
 * Not: `category.scoringRule` eskiden de vardı (kategori nesnesinin kökünde).
 * Geriye dönük uyumluluk için o da okunur.
 */
export function resolveCategoryRules(rules, category) {
    const flow = { ...DEFAULT_RULES.flow, ...(rules?.flow || {}) };
    const own  = category?.rules || {};

    const pick = (key, inherited) => {
        const v = own[key];
        return v === undefined || v === null || v === '' ? inherited : v;
    };

    // scoringRule: kategori kuralı > eski kök alan > yarışma geneli (anahtar kelime dahil)
    const inheritedRule = getScoringRuleFromKeywords(category, flow);
    const scoringRule = pick('scoringRule', category?.scoringRule || inheritedRule);

    return {
        scoringRule,
        routineCount: Number(pick('routineCount', flow.routineCount)) || flow.routineCount,
        hasDScore:    pick('hasDScore', flow.hasDScore) !== false,
        // Senkron kategorilerde takım sıralaması yapılmaz. Kategoride açıkça
        // aksi belirtilmediyse kapalıdır.
        hasTeam:      pick('hasTeam', category?.type === 'sync' ? false : flow.hasTeam) !== false,
        teamMode:     pick('teamMode', flow.teamMode),
        teamMinAthletes:
            Number(pick('teamMinAthletes', resolveTeamMin(category, flow))) || flow.teamMinAthletes,
        teamPerRoutineMinAthletes:
            Number(pick('teamPerRoutineMinAthletes', flow.teamPerRoutineMinAthletes))
            || flow.teamPerRoutineMinAthletes,
    };
}

/**
 * Takım için gereken en az sporcu sayısı — kategori adına göre.
 * Senkron kategorilerde anahtar kelime uygulanmaz; genel eşik geçerlidir.
 */
function resolveTeamMin(category, flow) {
    const base = Number(flow.teamMinAthletes) || 3;
    if (!category || category.type === 'sync') return base;
    const name = String(category.name || '').toLowerCase();
    for (const rule of (flow.teamMinByKeyword || [])) {
        const k = String(rule?.keyword || '').toLowerCase();
        if (k && name.includes(k)) return Number(rule.min) || base;
    }
    return base;
}

/** Kategori adındaki anahtar kelimelere göre sum/max kararı (eski davranış). */
function getScoringRuleFromKeywords(category, flow) {
    const r = { ...DEFAULT_RULES.flow, ...(flow || {}) };
    if (!category) return r.defaultScoringRule;
    const haystack = [category.name, category.ageGroup, category.id]
        .filter(Boolean).join(' ').toLowerCase();
    return (r.maxRuleKeywords || []).some(k => haystack.includes(String(k).toLowerCase()))
        ? 'max'
        : r.defaultScoringRule;
}

/** Kategori kuralını kaydeder. value null ise alan silinir (devral). */
export async function saveCategoryRule(compId, catId, key, value) {
    if (!compId || !catId) throw new Error('Yarışma veya kategori yok');
    await update(ref(db, `competitions/${compId}/categories/${catId}/rules`), { [key]: value });
}

