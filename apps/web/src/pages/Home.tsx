import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Public landing — premium/minimalist direction, brand palette (blue+red).
 * Motion is purposeful (v1.2 §UI):
 *  - one coordinated hero entrance (headline → brand rule draws in → copy → CTAs)
 *  - step cards reveal on scroll, once, staggered
 *  - all of it skipped under prefers-reduced-motion (content stays visible)
 */

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  {
    n: "01",
    title: "Scan or select your cylinder",
    body: "Every registered cylinder carries an identification QR. Scanning it opens the right request in one step — no typing serial numbers.",
  },
  {
    n: "02",
    title: "Submit in seconds",
    body: "Refills, complaints and enquiries go through one request flow with a reference you can track, whether you sign in or not.",
  },
  {
    n: "03",
    title: "Follow it to completion",
    body: "Live status from submission to delivery or resolution, with SMS updates and a private tracking link for guests.",
  },
] as const;

export default function Home() {
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from("[data-hero-eyebrow]", { y: 14, opacity: 0, duration: 0.5 })
        .from("[data-hero-line]", { y: 30, opacity: 0, duration: 0.7, stagger: 0.1 }, "-=0.2")
        .from(
          "[data-hero-rule]",
          { scaleX: 0, duration: 0.8, ease: "power3.inOut" },
          "-=0.35",
        )
        .from("[data-hero-sub]", { y: 16, opacity: 0, duration: 0.55 }, "-=0.45")
        .from("[data-hero-cta]", { y: 12, opacity: 0, duration: 0.5, stagger: 0.08 }, "-=0.3");

      // Steps: reveal once when the grid enters the viewport
      gsap.from("[data-step]", {
        y: 28,
        opacity: 0,
        duration: 0.65,
        stagger: 0.14,
        ease: "power2.out",
        scrollTrigger: {
          trigger: "[data-steps]",
          start: "top 82%",
          once: true,
        },
      });
    }, scope);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={scope}>
      {/* Hero */}
      <section className="relative overflow-hidden pb-16 pt-6 sm:pt-14">
        <div className="t-glow" aria-hidden="true" />

        <p
          data-hero-eyebrow
          className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tracking-wide"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
            color: "var(--primary)",
            background: "var(--primary-surface)",
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
            aria-hidden="true"
          />
          LPG refills · deliveries · support
        </p>

        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
          <span data-hero-line className="block">
            Cylinder service,
          </span>
          <span data-hero-line className="block">
            handled end to end.
          </span>
        </h1>

        <div
          data-hero-rule
          className="t-rule mt-6"
          style={{ height: 3, maxWidth: "11rem" }}
          aria-hidden="true"
        />

        <p data-hero-sub className="mt-6 max-w-xl text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Request a refill, report an issue or ask a question — then follow every step
          from our team to your door. One reference, one link, no guesswork.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link data-hero-cta to="/request" className="t-btn t-btn--primary t-btn--lg">
            Request a refill
          </Link>
          <Link data-hero-cta to="/track" className="t-btn t-btn--secondary t-btn--lg">
            Track a request
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section
        className="border-t py-14"
        style={{ borderColor: "var(--border)" }}
        aria-labelledby="how-heading"
      >
        <h2 id="how-heading" className="text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <div data-steps className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEPS.map((s) => (
            <article key={s.n} data-step className="t-card t-card--pad t-lift">
              <span
                className="text-xs font-semibold tracking-[0.18em]"
                style={{ color: "var(--accent)" }}
              >
                {s.n}
              </span>
              <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {s.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Reassurance strip */}
      <section
        className="relative overflow-hidden rounded-2xl border px-6 py-8 sm:px-8"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div
          className="absolute inset-y-0 left-0 w-1"
          style={{
            background: "linear-gradient(180deg, var(--primary), var(--accent))",
          }}
          aria-hidden="true"
        />
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Register your cylinder once
            </h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Every cylinder we service carries an identification QR code. Link it to
              your account and refills, warranties and safety checks follow the
              cylinder — not paperwork.
            </p>
          </div>
          <Link to="/request" className="t-btn t-btn--secondary t-btn--md shrink-0">
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
