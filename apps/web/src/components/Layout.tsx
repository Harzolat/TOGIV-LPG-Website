import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowRight, User } from "lucide-react";
import { useAuth } from "../lib/auth";
import NotificationsBell from "./NotificationsBell";

/**
 * Customer app shell — premium/minimalist direction, brand palette
 * (blue + red) from shared tokens (v1.2 §1.1).
 * Header: wordmark + primary nav (underline active state) + Login/Register
 * pills, brand rule beneath.
 * Route changes replay a short fade-up entrance (purposeful, reduced-motion
 * safe — the global guard in tokens.css neutralises it).
 * Footer: safety notice + policy links.
 */

function Wordmark() {
  return (
    <Link
      to="/"
      className="group inline-flex min-w-0 shrink items-center gap-1 sm:gap-1.5"
      aria-label="Throne of Grace Integrated Ventures — home"
    >
      <img
        src="/brand/togiv-white-logo.png"
        alt=""
        aria-hidden="true"
        className="block h-auto max-h-8 w-auto max-w-[56px] shrink-0 sm:max-h-10 sm:max-w-[68px]"
        style={{ objectFit: "contain" }}
        decoding="async"
      />
      <span className="inline-flex min-w-0 flex-col leading-none">
        <span
          className="truncate text-[0.78rem] font-semibold tracking-[0.12em] sm:text-[0.9375rem] sm:tracking-[0.14em]"
          style={{ color: "var(--text)" }}
        >
          THRONE OF GRACE
        </span>
        <span
          className="mt-0.5 truncate text-[0.58rem] uppercase tracking-[0.16em] transition-opacity duration-200 group-hover:opacity-80 sm:text-[0.6875rem] sm:tracking-[0.22em]"
          style={{ color: "var(--primary)" }}
        >
          Integrated Ventures
        </span>
      </span>
    </Link>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "px-3 py-2 text-sm transition-colors duration-200",
    isActive ? "font-medium" : "hover:opacity-70",
  ].join(" ");

/** Mockup-style active state: brand text + short underline drawn with an
 *  inset shadow, so switching states causes no layout shift. */
const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? "var(--primary)" : "var(--text)",
  boxShadow: isActive ? "inset 0 -2px 0 var(--primary)" : "none",
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
        className="sticky top-0 z-40 border-b backdrop-blur transition-all duration-300"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--background) 90%, transparent)" }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-6 sm:px-5">
          <Wordmark />

          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            <NavLink to="/" end className={navLinkClass} style={navLinkStyle}>
              Home
            </NavLink>
            <NavLink to="/request" className={navLinkClass} style={navLinkStyle}>
              Request
            </NavLink>
            <NavLink to="/safety" className={navLinkClass} style={navLinkStyle}>
              Safety
            </NavLink>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {loading ? (
              <span className="text-sm" style={{ color: "var(--text-muted)" }} aria-hidden="true">
                ···
              </span>
            ) : user ? (
              <>
                <NotificationsBell />
                <NavLink
                  to="/account"
                  className={({ isActive }) => `${navLinkClass({ isActive })} min-h-[44px] inline-flex items-center`}
                  style={navLinkStyle}
                >
                  <span className="sm:hidden">My orders</span>
                  <span className="hidden sm:inline">My requests</span>
                </NavLink>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Are you sure you want to sign out?")) {
                      void logout();
                    }
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-full px-2.5 py-1.5 text-sm transition-colors sm:px-3.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium sm:hidden"
                  style={{ color: "var(--text)" }}
                >
                  Login
                </Link>
                <Link
                  to="/login"
                  className="t-btn t-btn--secondary t-btn--sm hidden sm:inline-flex"
                  style={{ borderRadius: "var(--radius-pill)" }}
                >
                  <User size={15} aria-hidden="true" />
                  Login
                </Link>
                <Link
                  to="/register"
                  className="t-btn t-btn--primary t-btn--sm"
                  style={{ borderRadius: "var(--radius-pill)" }}
                >
                  <span className="sm:hidden">Register</span>
                  <span className="hidden sm:inline-flex items-center gap-1.5">
                    Register
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Mobile nav */}
        <nav
          aria-label="Primary (mobile)"
          className="flex gap-1 overflow-x-auto border-t px-3 py-2 sm:hidden scrollbar-none"
          style={{ borderColor: "var(--border)", WebkitOverflowScrolling: "touch" }}
        >
          <NavLink to="/" end className={({ isActive }) => `${navLinkClass({ isActive })} min-h-[44px] inline-flex items-center shrink-0`} style={navLinkStyle}>
            Home
          </NavLink>
          <NavLink to="/request" className={({ isActive }) => `${navLinkClass({ isActive })} min-h-[44px] inline-flex items-center shrink-0`} style={navLinkStyle}>
            Request refill
          </NavLink>
          {user ? (
            <NavLink to="/account" className={({ isActive }) => `${navLinkClass({ isActive })} min-h-[44px] inline-flex items-center shrink-0`} style={navLinkStyle}>
              My orders
            </NavLink>
          ) : (
            <NavLink to="/safety" className={({ isActive }) => `${navLinkClass({ isActive })} min-h-[44px] inline-flex items-center shrink-0`} style={navLinkStyle}>
              Safety
            </NavLink>
          )}
        </nav>

        {/* Brand rule: blue → red */}
        <div className="t-rule anim-fade-in" aria-hidden="true" style={{ height: 2 }} />
      </header>

      <main
        id="main"
        key={location.pathname}
        className="t-page-in mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-5 sm:py-10"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        <Outlet />
      </main>

      <footer className="border-t" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <Link to="/" className="inline-flex" aria-label="Throne of Grace Integrated Ventures — home">
              <img
                src="/brand/logo-full.png"
                alt="Throne of Grace Integrated Ventures"
                className="h-10 w-auto max-w-[220px]"
                style={{ objectFit: "contain" }}
                loading="lazy"
                decoding="async"
              />
            </Link>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              LPG customer service &amp; operations. Cylinder refills, deliveries and
              support requests — tracked from submission to completion.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              Emergency information
            </p>
            <div className="mt-2 space-y-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              <p>
                If you smell gas or suspect a leak, do not switch lights/appliances on or off, avoid flames or sparks, and move everyone to fresh air.
                If safe, open windows/doors for ventilation and turn off the cylinder valve.
              </p>
              <p>
                <strong style={{ color: "var(--text)" }}>Emergency contacts:</strong>{" "}
                <a href="tel:09013198496" className="font-medium" style={{ color: "var(--text)" }}>09013198496</a>
                {" · "}
                <a href="tel:08061265486" className="font-medium" style={{ color: "var(--text)" }}>08061265486</a>
              </p>
              <p>For fire or immediate danger to life or property, contact local emergency services right away.</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Policies
            </p>
            <ul className="mt-2 space-y-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              <li>
                <Link className="hover:underline" to="/privacy">
                  Privacy &amp; data protection
                </Link>
              </li>
              <li>
                <Link className="hover:underline" to="/safety">
                  Safety information
                </Link>
              </li>
              <li>
                <Link className="hover:underline" to="/terms">
                  Terms of service
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
