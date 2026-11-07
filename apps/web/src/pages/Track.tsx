import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { RequestType, RequestStatus, TrackPayload } from "../lib/types";
import { Button, EmptyState, ErrorState, Skeleton, StatusPill } from "@togi/ui";

/**
 * Public request tracking — two entry points:
 * - /track/:token  — guest one-time link (minimal PII payload, v1.2 §1.4.3)
 * - /track         — paste your reference... (link entry; reference-based
 *   lookup is intentionally not exposed: links are the public surface)
 *
 * Shows a status timeline derived from the request's status — the payload
 * is deliberately minimal (no name, phone, address or internal notes).
 */

const TIMELINES: Record<RequestType, RequestStatus[]> = {
  refill: ["Submitted", "Received", "UnderReview", "Accepted", "Processing", "Dispatched", "Completed"],
  complaint: ["Submitted", "Received", "UnderReview", "Accepted", "Processing", "Resolved"],
  enquiry: ["Submitted", "Received", "UnderReview", "Completed"],
};

const TERMINAL_BAD: RequestStatus[] = ["Rejected", "Cancelled"];

function Timeline({ type, status }: { type: RequestType; status: RequestStatus }) {
  const steps = TIMELINES[type];
  const badTerminal = TERMINAL_BAD.includes(status);

  if (badTerminal) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--neutral-surface)", color: "var(--text)" }}
      >
        This request was <strong>{status.toLowerCase()}</strong>. If you still need help,
        you can submit a new request.
      </div>
    );
  }

  const currentIndex = steps.indexOf(status);
  // Escalated isn't on the happy-path ladder but is a valid live state
  const escalated = status === "Escalated";

  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold${state === "current" ? " t-pulse" : ""}`}
                style={{
                  borderColor: state === "todo" ? "var(--border-strong)" : "var(--primary)",
                  background: state === "done" ? "var(--primary)" : "var(--surface-raised)",
                  color: state === "done" ? "var(--primary-contrast)" : state === "current" ? "var(--primary)" : "var(--text-muted)",
                }}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              {i < steps.length - 1 ? (
                <span
                  className="my-1 w-px flex-1"
                  style={{ background: i < currentIndex ? "var(--primary)" : "var(--border)" }}
                />
              ) : null}
            </div>
            <div className="pb-5 pt-0.5">
              <p
                className="text-sm"
                style={{
                  fontWeight: state === "current" ? 600 : 400,
                  color: state === "todo" ? "var(--text-muted)" : "var(--text)",
                }}
              >
                {step.replace(/([a-z])([A-Z])/g, "$1 $2")}
                {state === "current" ? (
                  <span className="ml-2 text-xs font-medium" style={{ color: "var(--primary)" }}>
                    (now)
                  </span>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
      {escalated ? (
        <li className="mt-1">
          <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--warning)", background: "var(--warning-surface)" }}>
            This request has been <strong>escalated</strong> to a supervisor. You'll be
            contacted with an update.
          </div>
        </li>
      ) : null}
    </ol>
  );
}

export default function Track() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "idle">(token ? "loading" : "idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [input, setInput] = useState("");

  const load = useCallback(async (raw: string) => {
    setState("loading");
    try {
      const payload = await api<TrackPayload>(`/requests/track/${encodeURIComponent(raw)}`);
      setData(payload);
      setState("ready");
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError && err.status === 404
          ? "This link is invalid, expired or has been revoked. Check that you copied it in full."
          : "We couldn't load this request right now. Please try again.",
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Skeleton width="12rem" height="1.5rem" />
        <Skeleton height="3rem" />
        <Skeleton height="12rem" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState
          title="We couldn't open this tracking link"
          description={errorMsg}
          action={
            <Link to="/track" className="t-btn t-btn--secondary t-btn--md">
              Try a different link
            </Link>
          }
        />
      </div>
    );
  }

  if (state === "ready" && data) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              {data.type}
            </p>
            <h1 className="mt-1 font-mono text-xl font-semibold">{data.reference}</h1>
          </div>
          <StatusPill status={data.status} />
        </div>

        <div className="t-card t-card--pad mt-6">
          <h2 className="mb-4 text-sm font-semibold">Progress</h2>
          <Timeline type={data.type} status={data.status} />
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Last updated{" "}
            {new Date(data.updatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Want all your requests in one place?
          </p>
          <Link to="/register" className="t-btn t-btn--secondary t-btn--sm">
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  // Idle: paste a tracking link
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Track a request</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        Paste the tracking link you received when you submitted a request. Signed-in
        customers can find everything under <Link to="/account" className="underline">My requests</Link>.
      </p>

      <form
        className="mt-6 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.trim();
          // Accept either the full path (/track/<token>) or the bare token
          const match = value.match(/\/track\/([A-Za-z0-9_-]{16,128})/);
          const raw = match ? match[1] : value;
          if (/^[A-Za-z0-9_-]{16,128}$/.test(raw)) {
            window.history.pushState(null, "", `/track/${raw}`);
            void load(raw);
          } else {
            setState("error");
            setErrorMsg("That doesn't look like a tracking link. It should look like yoursite.com/track/…");
          }
        }}
      >
        <label className="sr-only" htmlFor="track-link">
          Tracking link
        </label>
        <input
          id="track-link"
          className="t-input flex-1"
          placeholder="Paste tracking link"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit">Track</Button>
      </form>

      <div className="mt-10">
        <EmptyState
          title="No requests to show here yet"
          description="Submit a request and you'll get a reference and a private tracking link straight away."
          action={
            <Link to="/request" className="t-btn t-btn--primary t-btn--md">
              Submit a request
            </Link>
          }
        />
      </div>
    </div>
  );
}
