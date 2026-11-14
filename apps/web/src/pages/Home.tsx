import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  ClipboardList,
  Headset,
  MapPin,
  Phone,
  RefreshCw,
  Truck,
} from "lucide-react";

/**
 * Public landing — mobile-first, clear and action-oriented.
 * Messaging reflects the current service model:
 * - On-site refill: team comes to the customer's location to refill the cylinder
 * - Station refill: customer brings the cylinder to the station
 * No cylinder is dispatched to the customer.
 */

const HIGHLIGHTS = [
  { icon: MapPin, title: "Convenient On-site Refills", sub: "We come to your location" },
  { icon: Truck, title: "Flexible Station Refills", sub: "Bring your cylinder to us" },
  { icon: ClipboardList, title: "Clear Request Tracking", sub: "Follow progress in one place" },
  { icon: Headset, title: "Customer Support", sub: "We help when you need it" },
] as const;

const STEPS = [
  {
    n: "1",
    icon: ClipboardList,
    title: "Start a refill request",
    body: "Enter your contact details and cylinder information.",
  },
  {
    n: "2",
    icon: RefreshCw,
    title: "Choose on-site or station refill",
    body: "We refill at your location, or you bring the cylinder to our station.",
  },
  {
    n: "3",
    icon: ClipboardList,
    title: "Track request",
    body: "Track your on-site refill progress in your account.",
  },
] as const;

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
  const [highlightsRef, highlightsVisible] = useInView<HTMLDivElement>(!prefersReduced);
  const [stepsRef, stepsVisible] = useInView<HTMLDivElement>(!prefersReduced);

  useEffect(() => {
    const heroTargets = "[data-hero-img],[data-hero-badge],[data-hero-line],[data-hero-sub],[data-hero-cta]";
    if (prefersReduced) {
      gsap.set(heroTargets, { clearProps: "opacity,visibility,transform" });
      return;
    }

    const ctx = gsap.context(() => {
      gsap.set("[data-hero-cta],[data-hero-badge],[data-hero-line],[data-hero-sub]", { opacity: 1, visibility: "visible" });
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .fromTo("[data-hero-img]", { scale: 1.08 }, { scale: 1, duration: 1.6, ease: "power2.out" }, 0)
        .fromTo("[data-hero-badge]", { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45 }, 0.15)
        .fromTo("[data-hero-line]", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08 }, 0.25)
        .fromTo("[data-hero-sub]", { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, 0.55)
        .fromTo("[data-hero-cta]", { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.08 }, 0.7);
    }, scope);

    return () => ctx.revert();
  }, [prefersReduced]);

  return (
    <div ref={scope}>
      {/* Hero */}
      <section className="bleed-full relative -mt-8 overflow-hidden pb-14 pt-8 sm:-mt-10 sm:pb-20 sm:pt-14 lg:pb-24 lg:pt-16">
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
              alt="LPG cylinders ready for service"
              className="block h-full w-full object-cover"
              style={{ objectPosition: "62% center" }}
              decoding="async"
              fetchPriority="high"
            />
          </picture>
        </div>
        <div className="hero-scrim absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto w-full max-w-5xl px-4 sm:px-5">
          <div className="max-w-2xl">
            <h1 className="max-w-xl text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl">
              <span data-hero-line className="block">
                Safe, convenient LPG refills
              </span>
              <span data-hero-line className="block" style={{ color: "var(--primary)" }}>
                made simple.
              </span>
            </h1>

            <p
              data-hero-sub
              className="mt-4 max-w-lg text-base leading-relaxed sm:text-lg"
              style={{ color: "var(--text-muted)" }}
            >
              Request an on-site cylinder refill or bring your cylinder to our station.
              Submit your request and follow its progress with ease.
            </p>

            <div data-hero-sub className="mt-4 max-w-lg">
              <p className="text-sm font-semibold sm:text-base" style={{ color: "var(--text)" }}>
                Gas accessories
              </p>
              <p className="mt-1 text-sm leading-relaxed sm:text-base" style={{ color: "var(--text-muted)" }}>
                We also sell high-grade gas accessories to keep your kitchen safe and efficient.
              </p>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                data-hero-cta
                to="/request"
                className="t-btn t-btn--primary t-btn--lg w-full justify-center sm:w-auto"
                style={{ borderRadius: "var(--radius-pill)", visibility: "visible" }}
              >
                Request a Refill
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link
                data-hero-cta
                to="/safety"
                className="t-btn t-btn--secondary t-btn--lg w-full justify-center sm:w-auto"
                style={{ borderRadius: "var(--radius-pill)", visibility: "visible" }}
              >
                Contact us
                <Phone size={16} aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-8 sm:mt-10">
              <div
                ref={highlightsRef}
                className="t-card rounded-2xl"
                style={{ boxShadow: "var(--shadow-md)", background: "color-mix(in srgb, var(--surface-raised) 92%, transparent)" }}
              >
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                  {HIGHLIGHTS.map((f, i) => {
                    const Icon = f.icon;
                    return (
                      <li
                        key={f.title}
                        className={`flex items-center gap-3 px-4 py-4 t-reveal${highlightsVisible ? " is-visible" : ""}`}
                        style={{
                          "--reveal-delay": `${0.1 + i * 0.06}s`,
                          borderColor: "var(--border)",
                          borderTopWidth: i === 0 ? 0 : 1,
                        } as CSSProperties}
                      >
                        <Icon
                          size={24}
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
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-12 sm:py-16" aria-labelledby="how-heading">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] lg:gap-12">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--primary)" }}>
              How it works
            </p>
            <h2 id="how-heading" className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Get your cylinder refilled in 3 simple steps
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed sm:text-base" style={{ color: "var(--text-muted)" }}>
              Place a refill request, choose how you want it handled, and track progress from submission to completion.
            </p>
            <Link
              to="/request"
              className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold underline underline-offset-4"
              style={{ color: "var(--primary)" }}
            >
              Start a refill request
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          <div ref={stepsRef} className="grid gap-6 sm:grid-cols-3 sm:gap-4">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.n}
                  className={`t-reveal${stepsVisible ? " is-visible" : ""}`}
                  style={{ "--reveal-delay": `${i * 0.1}s` } as CSSProperties}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold"
                      style={{ background: "var(--accent-surface)", color: "var(--accent)" }}
                    >
                      {s.n}
                    </span>
                    <span
                      className="grid h-10 w-10 place-items-center rounded-xl"
                      style={{ background: "var(--primary-surface)", color: "var(--primary)" }}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
