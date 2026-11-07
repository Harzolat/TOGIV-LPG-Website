import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Customer app shell — premium/minimalist direction, brand palette
 * (blue + red) from shared tokens (v1.2 §1.1).
 * Header: wordmark + primary nav + session action, brand rule beneath.
 * Route changes replay a short fade-up entrance (purposeful, reduced-motion
 * safe — the global guard in tokens.css neutralises it).
 * Footer: safety notice + policy links.
 */

function Wordmark() {
  return (
    <Link to="/" className="group inline-flex flex-col leading-none" aria-label="Throne of Grace Integrated Ventures — home">
      <span
        className="text-[0.9375rem] font-semibold tracking-[0.14em]"
        style={{ color: "var(--text)" }}
      >
        THRONE OF GRACE
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
    "rounded-full px-3.5 py-1.5 text-sm transition-all duration-200",
    isActive ? "font-medium" : "hover:opacity-70",
  ].join(" ");

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? "var(--primary)" : "var(--text)",
  background: isActive ? "var(--primary-surface)" : "transparent",
});

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

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
            <NavLink to="/" end className={navLinkClass} style={navLinkStyle}>
              Home
            </NavLink>
            <NavLink to="/request" className={navLinkClass} style={navLinkStyle}>
              Request a refill
            </NavLink>
            <NavLink to="/track" className={navLinkClass} style={navLinkStyle}>
              Track
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            {loading ? (
              <span className="text-sm" style={{ color: "var(--text-muted)" }} aria-hidden="true">
                ···
              </span>
            ) : user ? (
              <>
                <NavLink
                  to="/account"
                  className={navLinkClass}
                  style={navLinkStyle}
                >
                  My requests
                </NavLink>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-full px-3.5 py-1.5 text-sm transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="t-btn t-btn--primary t-btn--sm"
                style={{ borderRadius: "var(--radius-pill)" }}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        {/* Mobile nav */}
        <nav
          aria-label="Primary (mobile)"
          className="flex gap-1 border-t px-4 py-2 sm:hidden"
          style={{ borderColor: "var(--border)" }}
        >
          <NavLink to="/" end className={navLinkClass} style={navLinkStyle}>
            Home
          </NavLink>
          <NavLink to="/request" className={navLinkClass} style={navLinkStyle}>
            Request
          </NavLink>
          <NavLink to="/track" className={navLinkClass} style={navLinkStyle}>
            Track
          </NavLink>
        </nav>

        {/* Brand rule: blue → red */}
        <div className="t-rule" aria-hidden="true" style={{ height: 2 }} />
      </header>

      <main
        id="main"
        key={location.pathname}
        className="t-page-in mx-auto w-full max-w-5xl flex-1 px-5 py-10"
      >
        <Outlet />
      </main>

      <footer className="border-t" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Throne of Grace Integrated Ventures
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              LPG customer service &amp; operations. Cylinder refills, deliveries and
              support requests — tracked from submission to completion.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              In an emergency
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              If you smell gas, move to open air, avoid switches and flames, and call
              your emergency line. Published emergency numbers are added from verified
              business settings before launch.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Policies
            </p>
            <ul className="mt-2 space-y-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              <li>
                <a className="hover:underline" href="/privacy">
                  Privacy &amp; data protection
                </a>
              </li>
              <li>
                <a className="hover:underline" href="/safety">
                  Safety information
                </a>
              </li>
              <li>
                <a className="hover:underline" href="/terms">
                  Terms of service
                </a>
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
