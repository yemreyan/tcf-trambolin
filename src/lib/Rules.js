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
        maxRuleKeywords: ['buyuk', 'büyük', '17+', '17_yas', 'senior', 'buyukler', 'büyükler', '21+'],
        finalistCount: 8,
        reserveCount: 2,
        teamTopN: 3,                    // takım puanına sayılan sporcu sayısı
    },

    // ── Ekran ve oturum ───────────────────────────────────────────────────
    session: {
        inactivityMinutes: 10,
        liveCycleSeconds: 8,            // canlı sonuç ekranı sayfa döngüsü
        athletesPerPage: 10,            // canlı sonuçta sayfa başına satır
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
