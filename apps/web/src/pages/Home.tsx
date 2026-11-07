import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";

/**
 * Public landing — premium/minimalist direction. Motion is purposeful:
 * a single coordinated entrance for the hero (never blocking content),
 * disabled under prefers-reduced-motion. Brand-neutral until assets arrive.
 */

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
        .from("[data-hero-line]", { y: 28, opacity: 0, duration: 0.7, stagger: 0.09 })
        .from("[data-hero-sub]", { y: 16, opacity: 0, duration: 0.55 }, "-=0.35")
        .from("[data-hero-cta]", { y: 12, opacity: 0, duration: 0.5, stagger: 0.08 }, "-=0.3");

      // Steps: single coordinated reveal on mount (no scroll plugin needed
      // for a short page — keeps motion predictable and purposeful)
      gsap.from("[data-step]", {
        y: 24,
        opacity: 0,
        duration: 0.6,
        stagger: 0.12,
        delay: 0.5,
        ease: "power2.out",
      });
    }, scope);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={scope}>
      {/* Hero */}
      <section className="pb-16 pt-6 sm:pt-14">
        <p
          className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs tracking-wide"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
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

        <p data-hero-sub className="mt-5 max-w-xl text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEPS.map((s) => (
            <article
              key={s.n}
              data-step
              className="t-card t-card--pad"
              style={{ background: "var(--surface-raised)" }}
            >
              <span
                className="text-xs font-semibold tracking-[0.18em]"
                style={{ color: "var(--text-muted)" }}
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
        className="rounded-2xl border px-6 py-8 sm:px-8"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
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
