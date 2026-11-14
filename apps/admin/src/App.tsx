import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@togi/ui";
import Layout from "./components/Layout";
import { AuthProvider, useAuth } from "./lib/auth";

const Login = lazy(() => import("./pages/Login"));
const Overview = lazy(() => import("./pages/Overview"));
const Queue = lazy(() => import("./pages/Queue"));
const RequestDetail = lazy(() => import("./pages/RequestDetail"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const Team = lazy(() => import("./pages/Team"));
const AddAdmin = lazy(() => import("./pages/AddAdmin"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

function PageFallback() {
  return (
    <div className="flex justify-center py-24">
      <span className="t-spinner h-7 w-7" role="status" aria-label="Loading" />
    </div>
  );
}

/** Session gate — the API enforces every route; this only keeps anonymous
 *  visitors on the sign-in screen instead of a wall of 403s. */
function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageFallback />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function page(element: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="login" element={page(<Login />)} />

            <Route
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route index element={<Navigate to="/overview" replace />} />
              <Route path="overview" element={page(<Overview />)} />
              <Route path="queue" element={page(<Queue />)} />
              <Route path="requests/:id" element={page(<RequestDetail />)} />
              <Route path="customers" element={page(<Customers />)} />
              <Route path="customers/:id" element={page(<CustomerDetail />)} />
              <Route path="team" element={page(<Team />)} />
              <Route path="add-admin" element={page(<AddAdmin />)} />
              <Route path="settings" element={page(<Settings />)} />
              <Route path="*" element={page(<NotFound />)} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
