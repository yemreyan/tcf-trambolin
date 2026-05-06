/**
 * DataService.js
 * Mevcut common.js (DataStore) + js/DataService.js mantığını tek modülde birleştirir.
 * React bileşenleri bu modülü import ederek kullanır.
 */

import {
    ref, get, set, update, remove, push, onValue
} from 'firebase/database';
import { db } from './firebase';

/**
 * Firebase undefined değerlere izin vermiyor.
 * Bu yardımcı undefined olan her değeri null'a çevirir (derin).
 */
export function stripUndefined(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = v === undefined ? null : stripUndefined(v);
    }
    return out;
}

// ── Sabitler ──────────────────────────────────────────────────────────────
export const Config = {
    ROLES: {
        ADMIN: 'admin',
        JUDGE_E: 'judge-e',
        JUDGE_D: 'judge-d',
        SCOREBOARD: 'scoreboard',
        CJP: 'cjp'
    },
    DEFAULT_CATEGORIES: {
        YAS_GRUPLARI: [
            '11-12 Yaş Kadınlar', '11-12 Yaş Erkekler',
            '13-14 Yaş Kadınlar', '13-14 Yaş Erkekler',
            '15-16 Yaş Kadınlar', '15-16 Yaş Erkekler',
            '17+ Yaş Kadınlar', '17+ Yaş Erkekler'
        ],
        KULUPLER: [
            'Minik Kadınlar (8-10 Yaş)', 'Minik Erkekler (8-10 Yaş)',
            'Küçük Kadınlar (11-12 Yaş)', 'Küçük Erkekler (11-12 Yaş)',
            'Yıldız Kadınlar (13-14 Yaş)', 'Yıldız Erkekler (13-14 Yaş)',
            'Genç Kadınlar (15-16 Yaş)', 'Genç Erkekler (15-16 Yaş)',
            'Büyük Kadınlar (17+ Yaş)', 'Büyük Erkekler (17+ Yaş)'
        ]
    }
};

// ── Yardımcılar ───────────────────────────────────────────────────────────
export const Utils = {
    id: (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    formatScore: (num) => (num ? Number(num).toFixed(3) : '0.000'),
    formatDeduct: (num) => (num ? Number(num).toFixed(1) : '0.0'),
};

/**
 * Herhangi bir sporcu objesinden görünen adı çıkarır.
 * Eski HTML sistemi farklı alan adları kullanmış olabilir (ad/soyad vs name/surname).
 */
export function getAthleteName(ath) {
    if (!ath) return '';
    // Önce hazır birleşik alanları dene
    if (ath.pairName) return ath.pairName;
    if (ath.displayName) return ath.displayName;
    // Olası alan adları: name/surname, ad/soyad, firstName/lastName, isim/soyisim
    const name    = ath.name    || ath.ad      || ath.firstName || ath.isim    || '';
    const surname = ath.surname || ath.soyad   || ath.lastName  || ath.soyisim || '';
    const full = `${surname} ${name}`.trim();
    return full || ath.id || '—';
}

/**
 * Sporcu kulübü/okul adını çıkarır (farklı alan isimleri desteğiyle).
 */
export function getAthleteClub(ath) {
    if (!ath) return '';
    return ath.club || ath.kulup || ath.okul || ath.school || '';
}

/**
 * Türkçe karakterleri normalize ederek Firebase-safe ID üretir.
 */
export function standardizeId(rawName, prefix = 'cat') {
    if (!rawName) return `${prefix}_${Date.now()}`;
    const charMap = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', ' ': '_' };
    let s = rawName.toLowerCase();
    for (const [k, v] of Object.entries(charMap)) s = s.split(k).join(v);
    s = s.replace(/[^a-z0-9_]/g, '');
    return `${prefix}_${s}`;
}

/**
 * Kategorinin puanlama kuralını döndürür: 'sum' | 'max'
 * Büyük / 17+ / senior → 'max' (R1 ve R2'nin maksimumu)
 * Diğerleri → 'sum' (R1 + R2 toplamı)
 */
export function getScoringRule(category) {
    if (!category) return 'sum';
    if (category.scoringRule) return category.scoringRule;
    const seniorKeywords = ['buyuk', 'büyük', '17+', '17_yas', 'senior', 'buyukler', 'büyükler', '21+'];
    const haystack = [category.name, category.ageGroup, category.id]
        .filter(Boolean).join(' ').toLowerCase();
    return seniorKeywords.some(k => haystack.includes(k)) ? 'max' : 'sum';
}

// ── DataStore (Yarışma CRUD) ───────────────────────────────────────────────
export const DataStore = {
    getAllCompetitions: async () => {
        const snap = await get(ref(db, 'competitions'));
        if (!snap.exists()) return [];
        return Object.values(snap.val()).filter(c => c && c.id);
    },

    saveCompetition: async (comp) => {
        await set(ref(db, `competitions/${comp.id}`), comp);
    },

    getCompetition: async (id) => {
        const snap = await get(ref(db, `competitions/${id}`));
        return snap.exists() ? snap.val() : null;
    },

    // Canlı yayın (scoreboard için)
    broadcastScore: async (compId, data) => {
        await set(ref(db, `live/${compId}`), data);
        if (data.score && data.athlete) {
            await set(ref(db, `scores/${compId}/${data.athlete.id}/${Date.now()}`), data.score);
        }
    },

    syncJudgeState: async (compId, judgeId, data) => {
        await set(ref(db, `live_judges/${compId}/${judgeId}`), data);
    },

    onLiveUpdate: (compId, callback) => {
        return onValue(ref(db, `live/${compId}`), (snap) => {
            if (snap.exists()) callback(snap.val());
        });
    },
};

// ── DataService (Yarışma-spesifik işlemler) ───────────────────────────────
export class DataService {
    #compId;

    constructor(compId) {
        this.#compId = compId;
    }

    get compId() { return this.#compId; }

    // Yarışma metadata güncellemesi
    async saveCompetition(compData) {
        if (!compData?.id) return;
        const updates = {};
        if (compData.categories) {
            const catObj = Array.isArray(compData.categories)
                ? Object.fromEntries(compData.categories.map(c => [c.id, c]))
                : compData.categories;
            updates[`competitions/${compData.id}/categories`] = catObj;
        }
        if (compData.athletes) updates[`competitions/${compData.id}/athletes`] = compData.athletes;
        if (compData.name) updates[`competitions/${compData.id}/name`] = compData.name;
        await update(ref(db), updates);
    }

    // ── Sporcular ──────────────────────────────────────────────────────────
    async getAthletes() {
        const snap = await get(ref(db, `competitions/${this.#compId}/athletes`));
        return snap.exists() ? snap.val() : {};
    }

    async addAthlete(data) {
        const id = data.id || Utils.id('ath');
        const athlete = { ...data, id, regDate: Date.now() };
        await set(ref(db, `competitions/${this.#compId}/athletes/${id}`), athlete);
        return athlete;
    }

    async deleteAthlete(id) {
        await remove(ref(db, `competitions/${this.#compId}/athletes/${id}`));
    }

    // ── Sonuçlar ───────────────────────────────────────────────────────────
    async publishResult(athId, routine, resultData) {
        const data = stripUndefined({
            ...resultData,
            athleteId: athId,
            routine: parseInt(routine),
            total: parseFloat(parseFloat(resultData.total || 0).toFixed(3)),
            status: resultData.status || 'published',
            isLive: null,
            timestamp: Date.now(),
        });
        await update(ref(db), {
            [`competitions/${this.#compId}/results/${athId}/r${routine}`]: data,
        });
        // CJP girdilerini temizle
        await remove(ref(db, `live/${this.#compId}/scores/cjp_inputs`));
        return data;
    }

    async getResults() {
        const snap = await get(ref(db, `competitions/${this.#compId}/results`));
        return snap.exists() ? snap.val() : {};
    }

    listenResults(callback) {
        return onValue(ref(db, `competitions/${this.#compId}/results`), snap => {
            callback(snap.val() || {});
        });
    }

    // ── Taslaklar ──────────────────────────────────────────────────────────
    async saveDraft(athId, routine, draftData) {
        await update(ref(db, `competitions/${this.#compId}/drafts/${athId}/r${routine}`), stripUndefined({
            ...draftData,
            updatedAt: Date.now(),
        }));
    }

    async saveJudgeDraft(athId, routine, judgeId, data) {
        if (!athId || !routine) return;
        await update(ref(db), {
            [`competitions/${this.#compId}/drafts/${athId}/r${routine}/judges/${judgeId}`]: {
                ...data, updatedAt: Date.now()
            },
            [`live/${this.#compId}/scores/judges/${judgeId}`]: {
                ...data, updatedAt: Date.now()
            },
        });
    }

    async getDraft(athId, routine) {
        const snap = await get(ref(db, `competitions/${this.#compId}/drafts/${athId}/r${routine}`));
        return snap.exists() ? snap.val() : null;
    }

    // ── Canlı Bağlam ───────────────────────────────────────────────────────
    listenActiveContext(panel, callback) {
        return onValue(
            ref(db, `live/${this.#compId}/panels/${panel}/activeContext`),
            snap => callback(snap.val())
        );
    }

    async updateActiveContext(panel, data) {
        await update(ref(db, `live/${this.#compId}/panels/${panel}/activeContext`), stripUndefined(data));
    }

    listenLiveScores(callback) {
        return onValue(ref(db, `live/${this.#compId}/scores/judges`), snap => {
            callback(snap.val() || {});
        });
    }

    listenJuryPanels(callback) {
        return onValue(ref(db, `competitions/${this.#compId}/juryPanels`), snap => {
            callback(snap.val() || {});
        });
    }

    // ── Sync Çiftler ───────────────────────────────────────────────────────
    async getPairs() {
        const snap = await get(ref(db, `competitions/${this.#compId}/pairs`));
        return snap.exists() ? snap.val() : {};
    }

    listenPairs(callback) {
        return onValue(ref(db, `competitions/${this.#compId}/pairs`), snap => {
            callback(snap.val() || {});
        });
    }

    async createPair(ath1, ath2, categoryId) {
        const pairId = Utils.id('pair');
        const displayName = `${ath1.surname || ath1.name} & ${ath2.surname || ath2.name}`;
        const pair = {
            id: pairId,
            categoryId,
            athlete1Id: ath1.id,
            athlete2Id: ath2.id,
            displayName,
            club: ath1.club || ath2.club || '',
            createdAt: Date.now(),
        };
        const updates = {};
        updates[`competitions/${this.#compId}/pairs/${pairId}`] = pair;
        updates[`competitions/${this.#compId}/athletes/${ath1.id}/pairId`] = pairId;
        updates[`competitions/${this.#compId}/athletes/${ath2.id}/pairId`] = pairId;
        await update(ref(db), updates);
        return pair;
    }

    async dissolvePair(pairId, athlete1Id, athlete2Id) {
        const updates = {};
        updates[`competitions/${this.#compId}/pairs/${pairId}`] = null;
        updates[`competitions/${this.#compId}/athletes/${athlete1Id}/pairId`] = null;
        updates[`competitions/${this.#compId}/athletes/${athlete2Id}/pairId`] = null;
        await update(ref(db), updates);
    }
}
