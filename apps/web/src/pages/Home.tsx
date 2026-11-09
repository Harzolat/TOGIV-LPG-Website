import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  Check,
  ClipboardList,
  Handshake,
  Headset,
  QrCode,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";

/**
 * Public landing — follows the approved mockup layout with the Throne of
 * Grace brand palette (blue + red, v1.2 §1.1):
 *  - hero: badge → two-tone headline → sub → pill CTAs, with the delivery
 *    photo bleeding off the right edge on large screens
 *  - floating highlight card (4 service promises) overlapping the hero
 *  - "How It Works": intro column + 3 numbered steps joined by connectors
 * Motion is purposeful and reduced-motion safe: a coordinated gsap hero
 * entrance, IntersectionObserver + CSS reveals for below-fold content.
 * The photo is the supplied LPG delivery-truck shot (no mockup imagery used).
 */

const FEATURES = [
  { icon: ShieldCheck, title: "Safe & Certified", sub: "Products" },
  { icon: Truck, title: "Fast Delivery", sub: "Home or Station" },
  { icon: Headset, title: "24/7 Support", sub: "Always Here" },
  { icon: Handshake, title: "Trusted Service", sub: "You Can Count On" },
] as const;

const STEPS = [
  {
    n: "1",
    icon: QrCode,
    title: "Scan QR Code",
    body: "Scan the QR code on your cylinder or location.",
  },
  {
    n: "2",
    icon: ClipboardList,
    title: "Make a Request",
    body: "Request a refill, report a problem or make an enquiry.",
  },
  {
    n: "3",
    icon: Check,
    title: "Track & Relax",
    body: "Track your request and get updates in real-time.",
  },
] as const;

/** Responsive divider borders for the highlight card (1 / 2 / 4 columns). */
function featureBorders(i: number): string {
  if (i === 0) return "";
  if (i === 1) return "border-t sm:border-t-0 sm:border-l";
  if (i === 2) return "border-t sm:border-t lg:border-t-0 lg:border-l";
  return "border-t sm:border-t sm:border-l lg:border-t-0 lg:border-l";
}

/** Reveal-on-scroll: CSS does the motion, the observer only flips a flag,
 *  so StrictMode re-runs and HMR can never strand content mid-animation.
 *  When `enabled` is false (reduced motion) content starts visible. */
function useInView<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return [ref, inView] as const;
}

export default function Home() {
  const scope = useRef<HTMLDivElement>(null);
  const [prefersReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [featuresRef, featuresVisible] = useInView<HTMLDivElement>(!prefersReduced);
  const [stepsRef, stepsVisible] = useInView<HTMLDivElement>(!prefersReduced);

  // Hero entrance — one coordinated timeline, skipped under reduced motion
  useEffect(() => {
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        // Background photo settles from a slow zoom (Ken Burns), then copy cascades
        .from("[data-hero-img]", { scale: 1.1, duration: 1.9, ease: "power2.out" }, 0)
        .from("[data-hero-badge]", { y: 14, opacity: 0, duration: 0.5 }, 0.2)
        .from("[data-hero-line]", { y: 30, opacity: 0, duration: 0.7, stagger: 0.1 }, 0.35)
        .from("[data-hero-rule]", { scaleX: 0, duration: 0.8, ease: "power3.inOut" }, 0.8)
        .from("[data-hero-sub]", { y: 16, opacity: 0, duration: 0.55 }, 0.9)
        .from("[data-hero-cta]", { y: 12, opacity: 0, duration: 0.5, stagger: 0.08 }, 1.05);
    }, scope);

    return () => ctx.revert();
  }, [prefersReduced]);

  return (
    <div ref={scope}>
      {/* Hero — delivery photo as the full-section background; copy sits
          left over a scrim that keeps every line fully legible. */}
      <section className="bleed-full relative -mt-10 overflow-hidden pb-28 pt-14 sm:pt-16 lg:pb-32 lg:pt-20">
        {/* Background photography */}
        <div className="absolute inset-0">
          <picture>
            <source
              type="image/webp"
              srcSet="/images/lpg-hero-900.webp 900w, /images/lpg-hero-1600.webp 1600w"
              sizes="100vw"
            />
            <img
              data-hero-img
              src="/images/lpg-hero-1600.jpg"
              srcSet="/images/lpg-hero-900.jpg 900w, /images/lpg-hero-1600.jpg 1600w"
              sizes="100vw"
              width={1600}
              height={900}
              alt="LPG delivery truck with its rear doors open, loaded with refilled cylinders in blue, red, yellow and grey, driving through the city"
              className="block h-full w-full object-cover"
              style={{ objectPosition: "62% center" }}
              decoding="async"
            />
          </picture>
        </div>
        <div className="hero-scrim absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto w-full max-w-5xl px-5">
          <div className="max-w-2xl">
            {/* Badge text uses --primary-hover (lighter blue): 5.2:1 on the
                tinted pill at 12px, where --primary only reaches 4.05:1. */}
            <p
              data-hero-badge
              className="mb-5 inline-flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-xs font-semibold"
              style={{ background: "var(--primary-surface)", color: "var(--primary-hover)" }}
            >
              <span
                className="grid h-5 w-5 place-items-center rounded-full"
                style={{ background: "var(--primary)" }}
                aria-hidden="true"
              >
                <Check size={12} strokeWidth={3} color="var(--primary-contrast)" />
              </span>
              Reliable LPG, Always
            </p>

            <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-[2.75rem] lg:text-[2.3rem] xl:text-[2.8rem]">
              <span data-hero-line className="block">
                Safe. Fast. Convenient.
              </span>
              <span data-hero-line className="block" style={{ color: "var(--primary)" }}>
                LPG Delivery
              </span>
            </h1>

            <div
              data-hero-rule
              className="t-rule mt-6"
              style={{ height: 3, maxWidth: "9rem" }}
              aria-hidden="true"
            />

            <p
              data-hero-sub
              className="mt-5 max-w-lg text-base leading-relaxed sm:text-lg"
              style={{ color: "var(--text-muted)" }}
            >
              Request your LPG refill, report an issue or make an enquiry with ease —
              anytime, anywhere.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                data-hero-cta
                to="/request"
                className="t-btn t-btn--primary t-btn--lg"
                style={{ borderRadius: "var(--radius-pill)" }}
              >
                Request Delivery
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link
                data-hero-cta
                to="/track"
                className="t-btn t-btn--secondary t-btn--lg"
                style={{ borderRadius: "var(--radius-pill)" }}
              >
                Track Your Request
                <Search size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Highlight card — floats over the hero's lower edge */}
      <section aria-label="Service highlights" className="relative z-10 -mt-16 lg:-mt-20">
        <div
          ref={featuresRef}
          className="t-card rounded-2xl"
          style={{ border: "none", borderRadius: "1rem", boxShadow: "var(--shadow-lg)" }}
        >
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <li
                  key={f.title}
                  className={`flex items-center gap-3.5 px-5 py-4 t-reveal${featuresVisible ? " is-visible" : ""} ${featureBorders(i)}`}
                  style={
                    {
                      "--reveal-delay": `${0.2 + i * 0.08}s`,
                      borderColor: "var(--border)",
                    } as CSSProperties
                  }
                >
                  <Icon
                    size={26}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    style={{ color: "var(--primary)", flexShrink: 0 }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {f.title}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {f.sub}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-14 sm:py-16" aria-labelledby="how-heading">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] lg:gap-14">
          {/* Intro column */}
          <div>
            <div className="flex items-center gap-3">
              <span
                className="t-rule"
                style={{ width: 28, height: 3 }}
                aria-hidden="true"
              />
              <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>
                How It Works
              </span>
            </div>
            <h2
              id="how-heading"
              className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl"
            >
              Get Your LPG
              <br />
              in 3 Simple Steps
            </h2>
            <p
              className="mt-4 max-w-sm text-base leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              Request, relax and let us take care of the rest.
            </p>
            <Link
              to="/request"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-75"
              style={{ color: "var(--primary)" }}
            >
              Learn More
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          {/* Steps */}
          <div ref={stepsRef} className="grid gap-8 sm:grid-cols-3 sm:gap-6 lg:gap-8">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const solid = i === STEPS.length - 1;
              return (
                <div
                  key={s.n}
                  className={`relative t-reveal${stepsVisible ? " is-visible" : ""}`}
                  style={{ "--reveal-delay": `${i * 0.14}s` } as CSSProperties}
                >
                  <div className="flex w-16 justify-center">
                    <span
                      className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold"
                      style={{ background: "var(--accent-surface)", color: "var(--accent)" }}
                    >
                      {s.n}
                    </span>
                  </div>
                  <div
                    className="t-lift mt-3 grid h-16 w-16 place-items-center rounded-2xl"
                    style={
                      solid
                        ? { background: "var(--primary)", color: "var(--primary-contrast)" }
                        : { background: "var(--primary-surface)", color: "var(--primary)" }
                    }
                  >
                    <Icon size={26} strokeWidth={solid ? 2.6 : 1.9} aria-hidden="true" />
                  </div>

                  {/* Connector to the next step (draws in when revealed) */}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="hidden lg:block"
                      style={{
                        position: "absolute",
                        top: 76,
                        left: 64,
                        right: -32,
                        height: 1,
                        background: "var(--border-strong)",
                        transform: stepsVisible ? "scaleX(1)" : "scaleX(0)",
                        transformOrigin: "left center",
                        transition: "transform 0.6s var(--ease)",
                        transitionDelay: `${0.4 + i * 0.14}s`,
                      }}
                    />
                  )}

                  <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                  <p
                    className="mt-1.5 text-sm leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {s.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
