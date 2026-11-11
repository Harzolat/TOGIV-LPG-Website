import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Package, Users, Settings as SettingsIcon, ClipboardList, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";

/** Admin console shell — matches the customer app shell (tokens + layout
 *  structure), converted to the staff surface. Same brand palette and the
 *  same top-out navigation, but the primary nav points at the staff queue
 *  and the account pill is replaced by a staff identity + sign-out. */
function Wordmark() {
  return (
    <Link to="/" className="group inline-flex flex-col leading-none" aria-label="TOGIV Operations — admin console">
      <span
        className="text-[0.9375rem] font-semibold tracking-[0.14em]"
        style={{ color: "var(--text)" }}
      >
        TOGIV OPERATIONS
      </span>
      <span
        className="mt-0.5 text-[0.6875rem] tracking-[0.22em] uppercase transition-opacity duration-200 group-hover:opacity-80"
        style={{ color: "var(--primary)" }}
      >
        Integrated Ventures
      </span>
    </Link>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "px-3 py-2 text-sm transition-colors duration-200",
    isActive ? "font-medium" : "hover:opacity-70",
  ].join(" ");

/** Active state drawn with an inset brand line, so toggling states causes
 *  no layout shift. */
const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? "var(--primary)" : "var(--text)",
  boxShadow: isActive ? "inset 0 -2px 0 var(--primary)" : "none",
});

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  // The directory requires customer:view_all — admins and super-admins only.
  // Agents keep the queue/claims (where they see customer names in context).
  const canViewCustomers = Boolean(
    user?.roles.some((r) => r === "admin" || r === "super_admin"),
  );

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--background)" }}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--background) 88%, transparent)" }}
      >
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-5">
          <Wordmark />

          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            <NavLink to="/queue" className={navLinkClass} style={navLinkStyle}>
              <Package size={15} aria-hidden="true" />
              <span className="ml-1.5">Queue</span>
            </NavLink>
            <NavLink to="/claims" className={navLinkClass} style={navLinkStyle}>
              <ClipboardList size={15} aria-hidden="true" />
              <span className="ml-1.5">Claims</span>
            </NavLink>
            {canViewCustomers ? (
              <NavLink to="/customers" className={navLinkClass} style={navLinkStyle}>
                <Users size={15} aria-hidden="true" />
                <span className="ml-1.5">Customers</span>
              </NavLink>
            ) : null}
            <NavLink to="/settings" className={navLinkClass} style={navLinkStyle}>
              <SettingsIcon size={15} aria-hidden="true" />
              <span className="ml-1.5">Settings</span>
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            {loading ? (
              <span className="text-sm" style={{ color: "var(--text-muted)" }} aria-hidden="true">
                ···
              </span>
            ) : user ? (
              <>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {user.fullName ?? user.phone}
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-full px-3.5 py-1.5 text-sm transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span className="ml-1.5">Sign out</span>
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Mobile nav */}
        <nav
          aria-label="Primary (mobile)"
          className="flex gap-1 border-t px-4 py-2 sm:hidden"
          style={{ borderColor: "var(--border)" }}
        >
          <NavLink to="/queue" className={navLinkClass} style={navLinkStyle}>
            <Package size={15} aria-hidden="true" />
            <span className="ml-1.5">Queue</span>
          </NavLink>
          <NavLink to="/claims" className={navLinkClass} style={navLinkStyle}>
            <ClipboardList size={15} aria-hidden="true" />
            <span className="ml-1.5">Claims</span>
          </NavLink>
          {canViewCustomers ? (
            <NavLink to="/customers" className={navLinkClass} style={navLinkStyle}>
              <Users size={15} aria-hidden="true" />
              <span className="ml-1.5">Customers</span>
            </NavLink>
          ) : null}
          <NavLink to="/settings" className={navLinkClass} style={navLinkStyle}>
            <SettingsIcon size={15} aria-hidden="true" />
            <span className="ml-1.5">Settings</span>
          </NavLink>
        </nav>

        <div className="t-rule" aria-hidden="true" style={{ height: 2 }} />
      </header>

      <main id="main" key={location.pathname} className="t-page-in mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <Outlet />
      </main>

      <footer className="border-t" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              TOGIV Operations
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Staff workspace — queue, claims, customers and settings for Throne of Grace Integrated Ventures.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              In an emergency
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              If you smell gas, move to open air, avoid switches and flames, and call
              your emergency line.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Console
            </p>
            <ul className="mt-2 space-y-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              <li>
                <Link className="hover:underline" to="/queue">
                  Request queue
                </Link>
              </li>
              <li>
                <Link className="hover:underline" to="/claims">
                  Claims review
                </Link>
              </li>
              <li>
                <Link className="hover:underline" to="/settings">
                  Account &amp; settings
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div
          className="border-t px-5 py-4 text-center text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          © {new Date().getFullYear()} Throne of Grace Integrated Ventures. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
