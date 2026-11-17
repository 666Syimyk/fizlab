import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { PageTransition } from "@/components/layout/PageTransition";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { CursorGlow } from "@/components/CursorGlow";
import { HomePageSkeleton } from "@/components/skeletons/HomePageSkeleton";
import { SectionPageSkeleton } from "@/components/skeletons/SectionPageSkeleton";
import { TopicPageSkeleton } from "@/components/skeletons/TopicPageSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingScreen } from "@/components/LoadingScreen";

const HomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));
const SectionPage = lazy(() =>
  import("@/pages/SectionPage").then((m) => ({ default: m.SectionPage })),
);
const TopicPage = lazy(() => import("@/pages/TopicPage").then((m) => ({ default: m.TopicPage })));
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import("@/pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const AccountPage = lazy(() =>
  import("@/pages/AccountPage").then((m) => ({ default: m.AccountPage })),
);
const PrivacyPage = lazy(() =>
  import("@/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
const RecoverPage = lazy(() =>
  import("@/pages/RecoverPage").then((m) => ({ default: m.RecoverPage })),
);
const SubscriptionPage = lazy(() => import("@/pages/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })));
const TermsPage = lazy(() => import("@/pages/TermsPage").then((m) => ({ default: m.TermsPage })));
const AdminPage = lazy(() => import("@/pages/admin/AdminPage").then((m) => ({ default: m.AdminPage })));

function App() {
  const location = useLocation();

  return (
    <>
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>
      <AnimatedBackground />
      <CursorGlow />
      <Header />
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
      <ErrorBoundary resetKey={location.pathname}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <PageTransition>
                <Suspense fallback={<HomePageSkeleton />}>
                  <HomePage />
                </Suspense>
              </PageTransition>
            }
          />
          <Route
            path="/section/:sectionId"
            element={
              <PageTransition>
                <Suspense fallback={<SectionPageSkeleton />}>
                  <SectionPage />
                </Suspense>
              </PageTransition>
            }
          />
          <Route
            path="/topic/:slug"
            element={
              <PageTransition>
                <Suspense fallback={<TopicPageSkeleton />}>
                  <TopicPage />
                </Suspense>
              </PageTransition>
            }
          />
          <Route
            path="/login"
            element={
              <PageTransition>
                <Suspense fallback={<LoadingScreen />}>
                  <LoginPage />
                </Suspense>
              </PageTransition>
            }
          />
          <Route
            path="/register"
            element={
              <PageTransition>
                <Suspense fallback={<LoadingScreen />}>
                  <RegisterPage />
                </Suspense>
              </PageTransition>
            }
          />
          <Route path="/account" element={<PageTransition><Suspense fallback={<LoadingScreen />}><AccountPage /></Suspense></PageTransition>} />
          <Route path="/admin" element={<PageTransition><Suspense fallback={<LoadingScreen />}><AdminPage /></Suspense></PageTransition>} />
          <Route path="/account/delete" element={<PageTransition><Suspense fallback={<LoadingScreen />}><AccountPage /></Suspense></PageTransition>} />
          <Route path="/privacy" element={<PageTransition><Suspense fallback={<LoadingScreen />}><PrivacyPage /></Suspense></PageTransition>} />
          <Route path="/subscription" element={<PageTransition><Suspense fallback={<LoadingScreen />}><SubscriptionPage /></Suspense></PageTransition>} />
          <Route path="/terms" element={<PageTransition><Suspense fallback={<LoadingScreen />}><TermsPage /></Suspense></PageTransition>} />
          <Route path="/recover" element={<PageTransition><Suspense fallback={<LoadingScreen />}><RecoverPage /></Suspense></PageTransition>} />
          <Route
            path="*"
            element={
              <PageTransition>
                <Suspense fallback={<LoadingScreen />}>
                  <NotFoundPage />
                </Suspense>
              </PageTransition>
            }
          />
        </Routes>
      </AnimatePresence>
      </ErrorBoundary>
      </main>
    </>
  );
}

export default App;
