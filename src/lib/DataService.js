/**
 * DataService.js
 * Mevcut common.js (DataStore) + js/DataService.js mantığını tek modülde birleştirir.
 * React bileşenleri bu modülü import ederek kullanır.
 */

import {
    ref, get, set, update, remove, push, onValue
} from 'firebase/database';
import { db } from './firebase';
import { DEFAULT_RULES } from './Rules';

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
    const full = `${name} ${surname}`.trim();
    return full || ath.id || '—';
}

/**
 * Senkron çiftin görünen adını üretir: "Ad Soyad & Ad Soyad".
 *
 * Çiftler oluşturulurken displayName alanına yalnızca soyadlar yazılıyordu,
 * bu yüzden isim mevcut kayıtlardan okunamıyor. Sporcu kayıtları verilirse
 * ad+soyad buradan kurulur; verilmezse/bulunamazsa kayıtlı ada düşülür.
 *
 * @param {object} pair  competitions/{id}/pairs/{pairId}
 * @param {object} athletesById  { [athleteId]: athlete }
 */
export function getPairDisplayName(pair, athletesById) {
    if (!pair) return '';
    const a1 = athletesById?.[pair.athlete1Id];
    const a2 = athletesById?.[pair.athlete2Id];
    if (a1 || a2) {
        const full = [a1, a2].filter(Boolean).map(getAthleteName).filter(Boolean).join(' & ');
        if (full) return full;
    }
    return pair.displayName || '';
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

// ── E / D Skor Hesaplama ──────────────────────────────────────────────────
// CJPPage içinde tanımlıydı; üst jüri ekranı da aynı sayıları göstermek
// zorunda olduğu için ortak modüle alındı. Mantık birebir korundu.

// ── E Skor Hesaplama (FIG kuralı — HTML cjp.html ile birebir aynı) ───────
// Her element için 6 hakemden en yüksek 2 + en düşük 2 kesilir, kalan toplanır.
// Landing ayrıca aynı şekilde kesilir.
// Not: JudgeCockpitPage `deductions` alanı olarak yazar (HTML ile uyumlu).
// Bireysel: base = elementCount × 2 (maks 20.0)
// Senkron:  base = elementCount × 1 (maks 10.0)  ← FIG Senkron kuralı
export function calcEScore(judgesData, elementCount = 10, isSync = false, scoring = DEFAULT_RULES.scoring) {
    const r = { ...DEFAULT_RULES.scoring, ...(scoring || {}) };
    const base = elementCount * (isSync ? r.basePerElementSync : r.basePerElementIndividual);

    // Eleme: yeterli not varsa en yüksek trimHigh ve en düşük trimLow atılır.
    // Varsayılan (6 hakem, 2+2) eski davranışın birebir aynısıdır.
    function trimDeductions(arr) {
        if (arr.length >= r.minJudgesForTrim) {
            arr.sort((a, b) => a - b);
            for (let i = 0; i < r.trimHigh && arr.length > 1; i++) arr.pop();
            for (let i = 0; i < r.trimLow && arr.length > 1; i++) arr.shift();
        } else if (arr.length >= 4) {
            // Eksik hakemle çalışılıyorsa daha ihtiyatlı ele: birer uç
            arr.sort((a, b) => a - b);
            arr.pop();
            if (arr.length > 2) arr.pop();
            arr.shift();
            if (arr.length > 2) arr.shift();
        }
        return arr.reduce((a, b) => a + b, 0);
    }

    let totalDeduction = 0;

    for (let elIdx = 0; elIdx < elementCount; elIdx++) {
        const elDeducts = [];
        for (let j = 1; j <= r.eJudgeCount; j++) {
            const jData = judgesData[`e${j}`];
            if (jData) {
                // `deductions` önce, geriye dönük uyumluluk için `scores` de dene
                const arr = jData.deductions || jData.scores;
                if (arr && arr[elIdx] !== undefined) {
                    elDeducts.push(parseFloat(arr[elIdx]) || 0);
                }
            }
        }
        totalDeduction += trimDeductions(elDeducts);
    }

    const landingArr = [];
    for (let j = 1; j <= r.eJudgeCount; j++) {
        const jData = judgesData[`e${j}`];
        if (jData && jData.landing !== undefined && jData.landing !== null && jData.landing !== '') {
            landingArr.push(parseFloat(jData.landing) || 0);
        }
    }
    totalDeduction += trimDeductions(landingArr);

    return Math.max(0, base - totalDeduction);
}

// ── Element Deductions Dizisi (Scoreboard timeline için) ─────────────────
// Her element için 6 hakemden trim edilen geçerli toplam → dizi döner
export function calcElementDeductions(judgesData, elementCount = 10) {
    const result = [];
    for (let i = 0; i < elementCount; i++) {
        let vals = [];
        for (let j = 1; j <= 6; j++) {
            const d = judgesData[`e${j}`];
            if (d?.deductions?.[i] !== undefined) vals.push(parseFloat(d.deductions[i]));
        }
        if (vals.length >= 6) {
            vals.sort((a, b) => a - b); vals.pop(); vals.pop(); vals.shift(); vals.shift();
        } else if (vals.length >= 4) {
            vals.sort((a, b) => a - b); vals.pop(); vals.shift();
        }
        result.push(parseFloat(vals.reduce((a, b) => a + b, 0).toFixed(3)));
    }
    return result;
}

// ── D Skor (D hakeminden okur — key: 'd', alan: 'val') ───────────────────
// Not: HTML CJP judges['d'].val formatı. JudgeCockpitPage de 'd' key + val yazar.
export function getDScoreFromJudge(judgesData) {
    const dJudge = judgesData?.d;
    if (dJudge && dJudge.val !== undefined && dJudge.val !== '') {
        return parseFloat(dJudge.val) || 0;
    }
    return null; // null = judge verisi yok, manuel giriş kullanılır
}


// ── Sonuç / Durum Yardımcıları ────────────────────────────────────────────
/**
 * Seri DNS veya DNF mi?
 * CJP büyük harf ('DNS'/'DNF') yayınlar, eski kayıtlarda küçük harf olabilir —
 * bu yüzden karşılaştırma her zaman normalize edilerek yapılır.
 */
export function isDNX(status) {
    const s = String(status || '').toUpperCase();
    return s === 'DNS' || s === 'DNF';
}

/**
 * Seri puanını ekrana/rapora yazılacak biçimde döndürür.
 * DNS/DNF ise puan yerine durum etiketi gösterilir.
 */
export function formatResultScore(val, status, dash = '—') {
    if (isDNX(status)) return String(status).toUpperCase();
    if (val == null) return dash;
    return Number(val).toFixed(3);
}

/**
 * İki seriden geçerli toplamı hesaplar.
 * DNS/DNF olan seri sıralamaya girmez (null sayılır) — böylece yarışmayan
 * sporcu 0.000 puanla derece almaz, puansız olarak listenin sonuna düşer.
 * @param {'sum'|'max'} rule
 */
export function computeRoutineTotals(r1d, r2d, rule) {
    const r1 = isDNX(r1d?.status) ? null : (r1d?.total ?? null);
    const r2 = isDNX(r2d?.status) ? null : (r2d?.total ?? null);
    const total = rule === 'max' ? Math.max(r1 || 0, r2 || 0) : (r1 || 0) + (r2 || 0);
    return { r1, r2, total };
}

/**
 * Kategorinin puanlama kuralını döndürür: 'sum' | 'max'
 * Büyük / 17+ / senior → 'max' (R1 ve R2'nin maksimumu)
 * Diğerleri → 'sum' (R1 + R2 toplamı)
 */
export function getScoringRule(category, flow = DEFAULT_RULES.flow) {
    const r = { ...DEFAULT_RULES.flow, ...(flow || {}) };
    if (!category) return r.defaultScoringRule;
    if (category.scoringRule) return category.scoringRule;
    const haystack = [category.name, category.ageGroup, category.id]
        .filter(Boolean).join(' ').toLowerCase();
    return (r.maxRuleKeywords || []).some(k => haystack.includes(String(k).toLowerCase()))
        ? 'max'
        : r.defaultScoringRule;
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
        // Yalnızca soyad yazılıyordu; isim de görünsün
        const displayName = `${getAthleteName(ath1)} & ${getAthleteName(ath2)}`.trim();
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

// ── Takım Sıralaması ──────────────────────────────────────────────────────
/**
 * Kulüp bazlı takım sıralaması. Canlı ve final sonuç ekranları aynı sayıyı
 * göstersin diye tek yerde hesaplanır.
 *
 * @param {Array}  rows  [{ a, r1, r2, total }] — bireysel sıralama satırları
 * @param {object} o     { topN, minAthletes, mode, perRoutineMinAthletes, routineCount }
 *
 * Yöntemler:
 *   'athleteTotal' → en iyi topN sporcunun GENEL toplamı
 *   'perRoutine'   → her serinin en iyi topN puanı ayrı seçilip toplanır
 *                    (yalnızca kulüpte perRoutineMinAthletes kadar sporcu varsa)
 *
 * minAthletes altındaki kulüpler takım sayılmaz ve listeye hiç girmez.
 */
export function computeTeamRanking(rows, o = {}) {
    const topN         = Number(o.topN) || 3;
    const minAthletes  = Number(o.minAthletes) || 1;
    const routineCount = Number(o.routineCount) || 2;
    const rule         = o.scoringRule === 'max' ? 'max' : 'sum';

    const nameOf = (row) => row?.name || getAthleteName(row?.a) || '—';

    const byClub = {};
    (rows || []).forEach(row => {
        const club = getAthleteClub(row.a) || row.a?.club || 'Bilinmeyen';
        if (!byClub[club]) byClub[club] = [];
        byClub[club].push(row);
    });

    const teams = Object.entries(byClub)
        // Yeterli sporcusu olmayan kulüp takım değildir
        .filter(([, rs]) => rs.length >= minAthletes)
        .map(([club, rs]) => {
            const byTotal = [...rs].sort((a, b) => b.total - a.total);

            const perRoutine =
                o.mode === 'perRoutine' &&
                rs.length >= (Number(o.perRoutineMinAthletes) || 4);

            // Her seri için puana SAYILAN sporcular ve o serinin ara toplamı.
            // Böylece "1. seriden kimin puanı geldi" ekranda görünebiliyor.
            let r1Picks = [], r2Picks = [];

            if (perRoutine) {
                // Her serinin en iyi N'i ayrı seçilir — farklı sporcular olabilir
                const bestOf = (key) => [...rs]
                    .filter(r => r[key] != null)
                    .sort((a, b) => b[key] - a[key])
                    .slice(0, topN)
                    .map(r => ({ name: nameOf(r), score: r[key] }));
                r1Picks = bestOf('r1');
                r2Picks = routineCount >= 2 ? bestOf('r2') : [];
            } else {
                const contributors = byTotal.slice(0, topN);
                if (rule === 'max') {
                    // Sporcunun yalnızca İYİ olan serisi sayılır
                    contributors.forEach(r => {
                        const a = r.r1 ?? null, b = r.r2 ?? null;
                        if (a == null && b == null) return;
                        const useR1 = b == null || (a != null && a >= b);
                        if (useR1) r1Picks.push({ name: nameOf(r), score: a });
                        else r2Picks.push({ name: nameOf(r), score: b });
                    });
                } else {
                    contributors.forEach(r => {
                        if (r.r1 != null) r1Picks.push({ name: nameOf(r), score: r.r1 });
                        if (routineCount >= 2 && r.r2 != null) r2Picks.push({ name: nameOf(r), score: r.r2 });
                    });
                }
            }

            const sum = (arr) => arr.reduce((a, p) => a + (p.score || 0), 0);
            const routines = [
                { key: 'r1', label: '1. Seri', picks: r1Picks, subtotal: sum(r1Picks) },
                ...(routineCount >= 2
                    ? [{ key: 'r2', label: '2. Seri', picks: r2Picks, subtotal: sum(r2Picks) }]
                    : []),
            ];

            const teamTotal = routines.reduce((a, r) => a + r.subtotal, 0);

            return {
                club,
                members: byTotal,
                top3: byTotal.slice(0, topN),
                teamTotal,
                perRoutine,
                routines,
            };
        });

    teams.sort((a, b) => b.teamTotal - a.teamTotal);
    return teams;
}
