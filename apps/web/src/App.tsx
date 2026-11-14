import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@togi/ui";
import Layout from "./components/Layout";
import { AuthProvider, useAuth } from "./lib/auth";
import Home from "./pages/Home";

const NewRequest = lazy(() => import("./pages/NewRequest"));
const Auth = lazy(() => import("./pages/Auth"));
const Account = lazy(() => import("./pages/Account"));
const AccountRequest = lazy(() => import("./pages/AccountRequest"));
const PolicyPages = lazy(() =>
  import("./pages/Policy").then((m) => ({ default: m.Privacy })),
);
const SafetyPage = lazy(() =>
  import("./pages/Policy").then((m) => ({ default: m.Safety })),
);
const TermsPage = lazy(() =>
  import("./pages/Policy").then((m) => ({ default: m.Terms })),
);

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <span className="t-spinner h-7 w-7" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: window.location.pathname }} />;
  return <>{children}</>;
}

function PageFallback() {
  return (
    <div className="flex justify-center py-24">
      <span className="t-spinner h-7 w-7" role="status" aria-label="Loading" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route
                path="request"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <NewRequest />
                  </Suspense>
                }
              />
              <Route
                path="login"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <Auth mode="login" />
                  </Suspense>
                }
              />
              <Route
                path="register"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <Auth mode="register" />
                  </Suspense>
                }
              />
              <Route
                path="account"
                element={
                  <Protected>
                    <Suspense fallback={<PageFallback />}>
                      <Account />
                    </Suspense>
                  </Protected>
                }
              />
              <Route
                path="account/requests/:id"
                element={
                  <Protected>
                    <Suspense fallback={<PageFallback />}>
                      <AccountRequest />
                    </Suspense>
                  </Protected>
                }
              />
              <Route
                path="privacy"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <PolicyPages />
                  </Suspense>
                }
              />
              <Route
                path="safety"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <SafetyPage />
                  </Suspense>
                }
              />
              <Route
                path="terms"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <TermsPage />
                  </Suspense>
                }
              />
              <Route
                path="*"
                element={
                  <div className="py-20 text-center">
                    <h1 className="text-2xl font-semibold">Page not found</h1>
                    <Link to="/" className="t-btn t-btn--secondary t-btn--md mt-6 inline-flex">
                      Back home
                    </Link>
                  </div>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
