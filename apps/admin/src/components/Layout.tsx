import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Package,
  Users,
  Settings as SettingsIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import NotificationsBell from "./NotificationsBell";

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/overview"
      className="group inline-flex min-w-0 items-center gap-2"
      aria-label="Throne of Grace — operations overview"
    >
      <img
        src="/brand/togiv-white-logo.png"
        alt=""
        aria-hidden="true"
        className={
          compact
            ? "block h-auto max-h-7 w-auto max-w-[44px] shrink-0"
            : "block h-auto max-h-9 w-auto max-w-[56px] shrink-0"
        }
        style={{ objectFit: "contain" }}
        decoding="async"
      />
      <span className="inline-flex min-w-0 flex-col leading-none">
        <span
          className={
            compact
              ? "truncate text-[0.8125rem] font-semibold tracking-[0.14em]"
              : "truncate text-[0.9375rem] font-semibold tracking-[0.14em]"
          }
          style={{ color: "var(--text)" }}
        >
          THRONE OF GRACE
        </span>
        <span
          className="mt-0.5 truncate text-[0.625rem] tracking-[0.22em] uppercase"
          style={{ color: "var(--primary)" }}
        >
          Refill operations
        </span>
      </span>
    </Link>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  onNavigate,
  end,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  onNavigate?: () => void;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate} className="admin-nav-link">
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

function NavGroups({
  canViewCustomers,
  onNavigate,
}: {
  canViewCustomers: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Console navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
      <p className="admin-nav-section">Workspace</p>
      <NavItem to="/overview" icon={LayoutDashboard} label="Overview" onNavigate={onNavigate} />
      <NavItem to="/queue" icon={Package} label="Orders" onNavigate={onNavigate} />

      {canViewCustomers ? (
        <>
          <p className="admin-nav-section mt-2">Customers</p>
          <NavItem to="/customers" icon={Users} label="Customers" onNavigate={onNavigate} />
        </>
      ) : null}

      <p className="admin-nav-section mt-2">Settings</p>
      <NavItem to="/settings" icon={SettingsIcon} label="Settings" onNavigate={onNavigate} />
    </nav>
  );
}

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const canViewCustomers = Boolean(
    user?.roles.some((r) => r === "admin" || r === "super_admin"),
  );

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const pageTitle = (() => {
    const p = location.pathname;
    if (p.startsWith("/overview")) return "Overview";
    if (p.startsWith("/queue")) return "Orders";
    if (p.startsWith("/requests/")) return "Order details";
    if (p.startsWith("/customers/")) return "Customer details";
    if (p.startsWith("/customers")) return "Customers";
    if (p.startsWith("/team")) return "Account";
    if (p.startsWith("/settings")) return "Settings";
    return "Operations";
  })();

  const identity = user?.fullName ?? user?.phone ?? "Account";

  return (
    <div className="admin-shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <aside className="admin-sidebar" aria-label="Sidebar">
        <div className="border-b px-4 py-4" style={{ borderColor: "var(--border)" }}>
          <Wordmark />
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Personal on-site refill operations
          </p>
        </div>
        <NavGroups canViewCustomers={canViewCustomers} />
        <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
          {loading ? (
            <p className="px-2 text-sm" style={{ color: "var(--text-muted)" }}>
              ···
            </p>
          ) : user ? (
            <div className="space-y-2">
              <div className="px-2">
                <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {identity}
                </p>
                <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {user.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Are you sure you want to sign out?")) {
                    void logout();
                  }
                }}
                className="admin-nav-link w-full justify-start"
              >
                <LogOut size={16} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="admin-main-wrap">
        <header className="admin-topbar">
          <div className="mx-auto flex h-14 max-w-[80rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border lg:hidden"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                aria-label={drawerOpen ? "Close menu" : "Open menu"}
                aria-expanded={drawerOpen}
                aria-controls="mobile-nav"
                onClick={() => setDrawerOpen((v) => !v)}
              >
                {drawerOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <div className="min-w-0 lg:hidden">
                <Wordmark compact />
              </div>
              <div className="hidden min-w-0 lg:block">
                <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
                  {pageTitle}
                </p>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm lg:hidden" style={{ color: "var(--text-muted)" }}>
                {pageTitle}
              </p>
              {!loading && user ? <NotificationsBell /> : null}
              {!loading && user ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Are you sure you want to sign out?")) {
                      void logout();
                    }
                  }}
                  className="hidden min-h-[44px] items-center gap-1.5 text-sm sm:inline-flex lg:hidden"
                  style={{ color: "var(--text-muted)" }}
                >
                  <LogOut size={15} aria-hidden="true" />
                  Sign out
                </button>
              ) : null}
            </div>
          </div>
          <div className="t-rule" aria-hidden="true" style={{ height: 2 }} />
        </header>

        <main id="main" key={location.pathname} className="admin-content t-page-in">
          <Outlet />
        </main>

        <footer
          className="border-t px-4 py-4 text-center text-xs sm:px-6 lg:px-8"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-muted)",
            background: "var(--surface)",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
        >
          © {new Date().getFullYear()} Throne of Grace Integrated Ventures. Secure console for
          on-site LPG cylinder refills.
        </footer>
      </div>

      {drawerOpen ? (
        <>
          <div
            className="admin-drawer-backdrop lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav"
            className="admin-drawer lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: "var(--border)" }}
            >
              <Wordmark compact />
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <NavGroups canViewCustomers={canViewCustomers} onNavigate={() => setDrawerOpen(false)} />
            <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
              {user ? (
                <div className="space-y-2">
                  <div className="px-2">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {identity}
                    </p>
                    <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {user.phone}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to sign out?")) {
                        setDrawerOpen(false);
                        void logout();
                      }
                    }}
                    className="admin-nav-link w-full justify-start"
                  >
                    <LogOut size={16} aria-hidden="true" />
                    <span>Sign out</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
