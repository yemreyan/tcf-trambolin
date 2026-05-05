/**
 * AuthContext.jsx
 * Mevcut auth.js (PasswordGate) mantığını React Context'e taşır.
 * - Yarışma admin şifresi (index → panel geçişi)
 * - Hakem / CJP ekranı şifre kapısı (10 dk inaktivite kilidi)
 * - Super admin master şifre: 63352180
 */

import { createContext, useContext, useState, useRef, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { db } from './firebase';

const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 dakika
const SESSION_KEY = 'judge_auth_session';
const SUPER_ADMIN_PASS = '63352180';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [adminCompId, setAdminCompId] = useState(null); // Hangi yarışma admin olarak açık
    const inactivityTimer = useRef(null);
    const activityListenersAdded = useRef(false);

    // ── Admin (index → panel) ──────────────────────────────────────────────
    /**
     * Yarışma admin şifresini doğrular.
     * Başarılıysa compId'yi context'e kaydeder ve localStorage'a yazar.
     * @returns {Promise<boolean>}
     */
    const verifyAdmin = useCallback(async (compId, password) => {
        if (password === SUPER_ADMIN_PASS) {
            _setActiveComp(compId);
            return true;
        }
        try {
            const snap = await get(ref(db, `competitions/${compId}/passwords/admin`));
            const stored = snap.exists() ? snap.val() : 'admin';
            if (password === stored) {
                _setActiveComp(compId);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }, []);

    const _setActiveComp = (id) => {
        setAdminCompId(id);
        localStorage.setItem('tra_active_comp', id);
    };

    const getActiveCompId = () =>
        adminCompId || localStorage.getItem('tra_active_comp');

    const clearActiveComp = () => {
        setAdminCompId(null);
        localStorage.removeItem('tra_active_comp');
    };

    // ── Hakem / CJP Şifre Kapısı ─────────────────────────────────────────
    /**
     * Hakem ekranı için şifre kapısı kontrolü.
     * Şifre yoksa true döner, varsa doğrulama yapılır.
     * @returns {Promise<'no_password' | boolean>}
     */
    const checkJudgeAccess = useCallback(async (compId, panel, role) => {
        try {
            const snap = await get(ref(db, `competitions/${compId}/passwords/panels/${panel}/${role}`));
            if (!snap.exists() || !snap.val()) return 'no_password';
            return snap.val(); // stored password string
        } catch {
            return 'no_password';
        }
    }, []);

    const verifyJudgePassword = useCallback(async (compId, panel, role, password) => {
        if (password === SUPER_ADMIN_PASS) return true;
        try {
            const snap = await get(ref(db, `competitions/${compId}/passwords/panels/${panel}/${role}`));
            if (!snap.exists()) return false;
            return snap.val() === password;
        } catch {
            return false;
        }
    }, []);

    // ── Session Storage (inaktivite) ──────────────────────────────────────
    const getJudgeSession = () => {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    };

    const saveJudgeSession = (compId, panel, role) => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            compId, panel, role, timestamp: Date.now()
        }));
    };

    const clearJudgeSession = () => sessionStorage.removeItem(SESSION_KEY);

    const isJudgeSessionValid = (compId, panel, role) => {
        const s = getJudgeSession();
        if (!s) return false;
        return (
            s.compId === compId &&
            s.panel === panel &&
            s.role === role &&
            s.timestamp > Date.now() - INACTIVITY_TIMEOUT
        );
    };

    // ── İnaktivite Sayacı ─────────────────────────────────────────────────
    const startInactivityTimer = useCallback((onLock) => {
        const reset = () => {
            if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
            inactivityTimer.current = setTimeout(onLock, INACTIVITY_TIMEOUT);
            // session timestamp yenile
            const s = getJudgeSession();
            if (s) saveJudgeSession(s.compId, s.panel, s.role);
        };

        if (!activityListenersAdded.current) {
            const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
            events.forEach(ev => document.addEventListener(ev, reset, { passive: true }));
            activityListenersAdded.current = true;
        }

        reset();
    }, []);

    const stopInactivityTimer = useCallback(() => {
        if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    }, []);

    return (
        <AuthContext.Provider value={{
            // Admin
            verifyAdmin,
            getActiveCompId,
            clearActiveComp,
            // Judge gate
            checkJudgeAccess,
            verifyJudgePassword,
            // Session
            saveJudgeSession,
            clearJudgeSession,
            isJudgeSessionValid,
            // Inactivity
            startInactivityTimer,
            stopInactivityTimer,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
