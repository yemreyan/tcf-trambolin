import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { NotificationProvider } from './lib/NotificationContext';

// ── Sayfalar (lazy load) ──────────────────────────────────────────────────
const CompetitionsPage  = lazy(() => import('./pages/CompetitionsPage'));
const PanelPage         = lazy(() => import('./pages/PanelPage'));
const CategoriesPage    = lazy(() => import('./pages/CategoriesPage'));
const RegistrationPage  = lazy(() => import('./pages/RegistrationPage'));
const StartListPage     = lazy(() => import('./pages/StartListPage'));
const JudgeCockpitPage  = lazy(() => import('./pages/JudgeCockpitPage'));
const CJPPage           = lazy(() => import('./pages/CJPPage'));
const JuryPage          = lazy(() => import('./pages/JuryPage'));
const ScoreboardPage    = lazy(() => import('./pages/ScoreboardPage'));
const ResultsLivePage   = lazy(() => import('./pages/ResultsLivePage'));
const ResultsFinalPage  = lazy(() => import('./pages/ResultsFinalPage'));
const CreateFinalsPage  = lazy(() => import('./pages/CreateFinalsPage'));
const PasswordAdminPage = lazy(() => import('./pages/PasswordAdminPage'));
const AdminToolsPage    = lazy(() => import('./pages/AdminToolsPage'));
const JudgeAnalysisPage = lazy(() => import('./pages/JudgeAnalysisPage'));

// ── Yükleme Ekranı ────────────────────────────────────────────────────────
const PageLoader = () => (
    <div className="page-loader">
        <div className="spinner" />
        <span>Yükleniyor...</span>
    </div>
);

export default function App() {
    return (
        <AuthProvider>
            <NotificationProvider>
                <BrowserRouter>
                    <Suspense fallback={<PageLoader />}>
                        <Routes>
                            {/* Ana sayfa: Yarışma Seçimi */}
                            <Route path="/"                  element={<CompetitionsPage />} />

                            {/* Yarışma bazlı rotalar */}
                            <Route path="/panel"             element={<PanelPage />} />
                            <Route path="/categories"        element={<CategoriesPage />} />
                            <Route path="/registration"      element={<RegistrationPage />} />
                            <Route path="/start-list"        element={<StartListPage />} />
                            <Route path="/jury"              element={<JuryPage />} />
                            <Route path="/password-admin"    element={<PasswordAdminPage />} />
                            <Route path="/create-finals"     element={<CreateFinalsPage />} />
                            <Route path="/admin-tools"       element={<AdminToolsPage />} />
                            <Route path="/judge-analysis"    element={<JudgeAnalysisPage />} />

                            {/* Yeni pencerede açılan rotalar */}
                            <Route path="/judge-cockpit"     element={<JudgeCockpitPage />} />
                            <Route path="/cjp"               element={<CJPPage />} />
                            <Route path="/scoreboard"        element={<ScoreboardPage />} />
                            <Route path="/results/live"      element={<ResultsLivePage />} />
                            <Route path="/results/final"     element={<ResultsFinalPage />} />

                            {/* Bilinmeyen rota → ana sayfa */}
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </Suspense>
                </BrowserRouter>
            </NotificationProvider>
        </AuthProvider>
    );
}
