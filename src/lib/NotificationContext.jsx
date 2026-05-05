/**
 * NotificationContext.jsx
 * Mevcut UI.toast / UI.confirm / UI.prompt mantığını React'e taşır.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const NotificationContext = createContext(null);

let toastIdCounter = 0;

export function NotificationProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const [modal, setModal] = useState(null); // { type, title, message, resolve, ... }
    const resolveRef = useRef(null);

    // ── Toast ──────────────────────────────────────────────────────────────
    const toast = useCallback((msg, type = 'info') => {
        const id = ++toastIdCounter;
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3500);
    }, []);

    // ── Confirm Modal ──────────────────────────────────────────────────────
    const confirm = useCallback((title, message) => {
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setModal({ type: 'confirm', title, message });
        });
    }, []);

    // ── Prompt Modal ───────────────────────────────────────────────────────
    const prompt = useCallback((title, placeholder = '', defaultValue = '', inputType = 'text') => {
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setModal({ type: 'prompt', title, placeholder, defaultValue, inputType });
        });
    }, []);

    const promptSelect = useCallback((title, options, defaultValue = '') => {
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setModal({ type: 'select', title, options, defaultValue });
        });
    }, []);

    const closeModal = (result) => {
        setModal(null);
        if (resolveRef.current) {
            resolveRef.current(result);
            resolveRef.current = null;
        }
    };

    return (
        <NotificationContext.Provider value={{ toast, confirm, prompt, promptSelect }}>
            {children}

            {/* Toast Container */}
            <div style={{
                position: 'fixed', bottom: 24, right: 24,
                display: 'flex', flexDirection: 'column', gap: 10,
                zIndex: 99999, maxWidth: 360,
            }}>
                {toasts.map(t => (
                    <Toast key={t.id} msg={t.msg} type={t.type} />
                ))}
            </div>

            {/* Modal */}
            {modal && (
                <ModalOverlay modal={modal} onClose={closeModal} />
            )}
        </NotificationContext.Provider>
    );
}

function Toast({ msg, type }) {
    const icons = { success: 'check_circle', error: 'error_outline', warning: 'warning_amber', info: 'info_outline' };
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#38bdf8' };
    const color = colors[type] || colors.info;
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(15,23,42,0.95)', border: `1px solid ${color}40`,
            borderLeft: `3px solid ${color}`, borderRadius: 12,
            padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(12px)', color: '#f8fafc',
            fontFamily: "'Outfit', sans-serif", fontSize: '0.9rem',
            animation: 'slideInRight 0.3s ease',
        }}>
            <i className="material-icons-round" style={{ color, fontSize: '1.3rem' }}>
                {icons[type] || icons.info}
            </i>
            <span style={{ fontWeight: 500 }}>{msg}</span>
            <style>{`@keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
        </div>
    );
}

function ModalOverlay({ modal, onClose }) {
    const inputRef = useRef(null);

    const handleOk = () => {
        if (modal.type === 'confirm') onClose(true);
        else if (modal.type === 'prompt') onClose(inputRef.current?.value ?? null);
        else if (modal.type === 'select') onClose(inputRef.current?.value ?? null);
    };

    const handleCancel = () => {
        if (modal.type === 'confirm') onClose(false);
        else onClose(null);
    };

    const handleKey = (e) => {
        if (e.key === 'Enter') handleOk();
        if (e.key === 'Escape') handleCancel();
    };

    return (
        <div
            onClick={(e) => e.target === e.currentTarget && handleCancel()}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                zIndex: 99998, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(6px)',
            }}
        >
            <div style={{
                background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 20, padding: 32, maxWidth: 420, width: '90%',
                boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                fontFamily: "'Outfit', sans-serif",
            }}>
                <h3 style={{ margin: '0 0 12px', color: 'white', fontSize: '1.2rem' }}>{modal.title}</h3>

                {modal.type === 'confirm' && (
                    <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>{modal.message}</p>
                )}

                {modal.type === 'prompt' && (
                    <input
                        ref={inputRef}
                        type={modal.inputType || 'text'}
                        defaultValue={modal.defaultValue || ''}
                        placeholder={modal.placeholder || ''}
                        onKeyDown={handleKey}
                        autoFocus
                        style={{
                            width: '100%', padding: '12px 16px',
                            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 10, color: 'white', fontSize: '1rem',
                            marginBottom: 20, boxSizing: 'border-box',
                            fontFamily: "'Outfit', sans-serif",
                        }}
                    />
                )}

                {modal.type === 'select' && (
                    <select
                        ref={inputRef}
                        defaultValue={modal.defaultValue}
                        onKeyDown={handleKey}
                        style={{
                            width: '100%', padding: '12px 16px',
                            background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 10, color: 'white', fontSize: '1rem',
                            marginBottom: 20, boxSizing: 'border-box',
                        }}
                    >
                        {modal.options?.map(o => (
                            <option key={o.value} value={o.value}>{o.text}</option>
                        ))}
                    </select>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={handleCancel} style={btnStyle('outline')}>İptal</button>
                    <button onClick={handleOk} style={btnStyle('primary')}>
                        {modal.type === 'confirm' ? 'Onayla' : 'Tamam'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function btnStyle(variant) {
    const base = {
        padding: '10px 22px', borderRadius: 10, fontWeight: 700,
        fontSize: '0.9rem', cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
        transition: 'all 0.2s',
    };
    if (variant === 'primary') return { ...base, background: '#38bdf8', border: 'none', color: '#000' };
    return { ...base, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#94a3b8' };
}

export const useNotification = () => useContext(NotificationContext);
