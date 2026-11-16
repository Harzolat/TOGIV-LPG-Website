import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Copy, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import {
  Button,
  Card,
  ErrorState,
  Skeleton,
  StatusPill,
  TextInput,
  useToast,
} from "@togi/ui";
import type {
  CustomerDetail,
  CustomerProfile,
  PinResetAuthorization,
  PinResetIssueResult,
  StaffMember,
  StaffPasswordResetAuthorization,
  StaffPasswordResetIssueResult,
} from "@togi/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePolling } from "../lib/usePolling";

/**
 * Account recovery — the operator's authorization desk.
 *
 * Customers: verify identity outside the app, then issue a single-use,
 * short-lived PIN reset token. The token is shown once and never retrievable
 * afterwards; every authorization is visible in the audit list below.
 *
 * Staff (super_admin only): password recovery and authenticator recovery are
 * two separate operations with separate confirmations. Password recovery
 * preserves TOTP; authenticator recovery preserves the password.
 */

const STATUS_TONE = {
  pending: "warning",
  completed: "success",
  expired: "neutral",
  revoked: "error",
} as const satisfies Record<string, "warning" | "success" | "neutral" | "error">;

const STATUS_LABEL = {
  pending: "Pending",
  completed: "Completed",
  expired: "Expired",
  revoked: "Revoked",
} as const satisfies Record<string, string>;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const { toast } = useToast();
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<Copy size={14} aria-hidden="true" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast({ message: "Copied.", tone: "success" });
        } catch {
          toast({
            message: "Copy failed — select and copy manually.",
            tone: "error",
          });
        }
      }}
    >
      {label}
    </Button>
  );
}

export default function Recovery() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const deepLinkId = params.get("customer");

  const roles = user?.roles ?? [];
  const canRecoverCustomers =
    roles.includes("admin") || roles.includes("super_admin");
  const isSuperAdmin = roles.includes("super_admin");

  // ── Customer search + token issuance ──────────────────────────────
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerProfile[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerProfile | null>(null);
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<PinResetIssueResult | null>(null);

  // ── Authorization history ─────────────────────────────────────────
  const [resets, setResets] = useState<PinResetAuthorization[] | null>(null);
  const [resetsError, setResetsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // ── Staff recovery ────────────────────────────────────────────────
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffBusyId, setStaffBusyId] = useState<string | null>(null);
  const [staffResult, setStaffResult] = useState<
    | {
        kind: "password";
        name: string;
        temporaryPassword: string;
        notice: string;
      }
    | {
        kind: "password-token";
        name: string;
        resetToken: string;
        expiresAt: string;
        notice: string;
      }
    | { kind: "authenticator"; name: string; notice: string }
    | null
  >(null);
  const [staffVerified, setStaffVerified] = useState<Record<string, boolean>>({});
  const [staffNote, setStaffNote] = useState<Record<string, string>>({});
  const [staffResets, setStaffResets] = useState<StaffPasswordResetAuthorization[] | null>(null);
  const [staffResetsError, setStaffResetsError] = useState<string | null>(null);
  const [revokingStaffResetId, setRevokingStaffResetId] = useState<string | null>(null);

  const loadResets = useCallback(async () => {
    try {
      const res = await api<{ resets: PinResetAuthorization[] }>(
        "/admin/recovery/pin-resets",
      );
      setResets(res.resets);
      setResetsError(null);
    } catch (err) {
      setResetsError(
        err instanceof ApiError
          ? err.message
          : "Could not load recovery history.",
      );
    }
  }, []);

  usePolling(loadResets, { intervalMs: 15_000, enabled: canRecoverCustomers });

  const loadStaff = useCallback(async () => {
    try {
      const res = await api<{ staff: StaffMember[] }>("/admin/staff");
      setStaff(res.staff);
      setStaffError(null);
    } catch (err) {
      setStaffError(
        err instanceof ApiError ? err.message : "Could not load staff accounts.",
      );
    }
  }, []);

  const loadStaffResets = useCallback(async () => {
    try {
      const res = await api<{ resets: StaffPasswordResetAuthorization[] }>(
        "/admin/recovery/staff-password-resets",
      );
      setStaffResets(res.resets);
      setStaffResetsError(null);
    } catch (err) {
      setStaffResetsError(
        err instanceof ApiError
          ? err.message
          : "Could not load staff password reset history.",
      );
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      void loadStaff();
      void loadStaffResets();
    }
  }, [isSuperAdmin, loadStaff, loadStaffResets]);

  // Deep link from the customer detail page.
  useEffect(() => {
    if (!deepLinkId) return;
    let cancelled = false;
    api<CustomerDetail>(`/customers/${deepLinkId}`)
      .then((customer) => {
        if (cancelled) return;
        setSelected(customer);
        setResults([customer]);
        setQuery(customer.phone);
      })
      .catch((err) => {
        if (cancelled) return;
        setSearchError(
          err instanceof ApiError ? err.message : "Could not load that customer.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkId]);

  async function searchCustomers(e: React.FormEvent) {
    e.preventDefault();
    setSearchBusy(true);
    setSearchError(null);
    try {
      const term = query.trim();
      const res = await api<{ customers: CustomerProfile[] }>(
        `/customers${term ? `?q=${encodeURIComponent(term)}` : ""}`,
      );
      setResults(res.customers);
    } catch (err) {
      setSearchError(
        err instanceof ApiError ? err.message : "Could not search customers.",
      );
    } finally {
      setSearchBusy(false);
    }
  }

  async function issueToken() {
    if (!selected) return;
    if (
      !window.confirm(
        `Issue a single-use PIN reset token for ${selected.fullName}? Only do this after verifying their identity outside this app.`,
      )
    ) {
      return;
    }
    setIssuing(true);
    setIssueError(null);
    setIssued(null);
    try {
      const res = await api<PinResetIssueResult>(
        `/admin/customers/${selected.id}/pin-reset`,
        {
          method: "POST",
          body: { note: note.trim() || undefined },
        },
      );
      setIssued(res);
      setVerified(false);
      setNote("");
      toast({ message: "PIN reset token issued.", tone: "success" });
      void loadResets();
    } catch (err) {
      setIssueError(
        err instanceof ApiError
          ? err.message
          : "Could not issue a reset token.",
      );
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(id: string) {
    if (
      !window.confirm(
        "Cancel this reset authorization? The token will stop working immediately.",
      )
    ) {
      return;
    }
    setRevokingId(id);
    try {
      await api(`/admin/recovery/pin-resets/${id}/revoke`, { method: "POST" });
      toast({ message: "Authorization revoked.", tone: "success" });
      void loadResets();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError ? err.message : "Could not revoke the token.",
        tone: "error",
      });
    } finally {
      setRevokingId(null);
    }
  }

  async function resetStaffPassword(member: StaffMember) {
    if (
      !window.confirm(
        `Replace ${member.fullName}'s password with a one-time temporary password? Their authenticator stays enrolled and all their sessions will be signed out.`,
      )
    ) {
      return;
    }
    setStaffBusyId(member.id);
    try {
      const res = await api<{
        temporaryPassword: string;
        notice: string;
      }>(`/admin/staff/${member.id}/password-reset`, { method: "POST" });
      setStaffResult({
        kind: "password",
        name: member.fullName,
        temporaryPassword: res.temporaryPassword,
        notice: res.notice,
      });
      toast({ message: "Temporary password issued.", tone: "success" });
    } catch (err) {
      toast({
        message:
          err instanceof ApiError
            ? err.message
            : "Could not reset the password.",
        tone: "error",
      });
    } finally {
      setStaffBusyId(null);
    }
  }

  async function issueStaffPasswordResetToken(member: StaffMember) {
    if (!staffVerified[member.id]) {
      toast({ message: "Confirm identity verification first.", tone: "error" });
      return;
    }
    if (
      !window.confirm(
        `Issue a single-use password reset token for ${member.fullName}? Their authenticator stays enrolled and all sessions will be signed out when the token is used.`,
      )
    ) {
      return;
    }
    setStaffBusyId(member.id);
    try {
      const res = await api<StaffPasswordResetIssueResult>(
        `/admin/staff/${member.id}/password-reset-token`,
        {
          method: "POST",
          body: { note: (staffNote[member.id] ?? "").trim() || undefined },
        },
      );
      setStaffResult({
        kind: "password-token",
        name: member.fullName,
        resetToken: res.resetToken,
        expiresAt: res.expiresAt,
        notice: res.notice,
      });
      setStaffVerified((s) => ({ ...s, [member.id]: false }));
      setStaffNote((s) => ({ ...s, [member.id]: "" }));
      toast({ message: "Password reset token issued.", tone: "success" });
      void loadStaffResets();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError
            ? err.message
            : "Could not issue a password reset token.",
        tone: "error",
      });
    } finally {
      setStaffBusyId(null);
    }
  }

  async function revokeStaffPasswordReset(id: string) {
    if (
      !window.confirm(
        "Cancel this staff password reset authorization? The token will stop working immediately.",
      )
    ) {
      return;
    }
    setRevokingStaffResetId(id);
    try {
      await api(`/admin/recovery/staff-password-resets/${id}/revoke`, { method: "POST" });
      toast({ message: "Authorization revoked.", tone: "success" });
      void loadStaffResets();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError ? err.message : "Could not revoke the token.",
        tone: "error",
      });
    } finally {
      setRevokingStaffResetId(null);
    }
  }

  async function resetStaffAuthenticator(member: StaffMember) {
    if (
      !window.confirm(
        `Clear ${member.fullName}'s authenticator enrollment? Their password is unchanged, but they must set up an authenticator again at next sign-in. This does not change their permissions.`,
      )
    ) {
      return;
    }
    setStaffBusyId(member.id);
    try {
      const res = await api<{ notice: string }>(
        `/admin/staff/${member.id}/authenticator-reset`,
        { method: "POST", body: { confirm: true } },
      );
      setStaffResult({
        kind: "authenticator",
        name: member.fullName,
        notice: res.notice,
      });
      toast({ message: "Authenticator enrollment cleared.", tone: "success" });
      void loadStaff();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError
            ? err.message
            : "Could not reset the authenticator.",
        tone: "error",
      });
    } finally {
      setStaffBusyId(null);
    }
  }

  const otherStaff = useMemo(
    () => (staff ?? []).filter((member) => member.id !== user?.id),
    [staff, user?.id],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <p
          className="text-xs font-medium uppercase tracking-[0.16em]"
          style={{ color: "var(--primary)" }}
        >
          Security
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Account recovery
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
          Authorize a customer PIN reset after verifying identity outside the
          application, or recover a staff account. Every action is recorded in
          the audit log.
        </p>
      </header>

      {!canRecoverCustomers ? (
        <Card padded>
          <ErrorState
            title="Not available for your role"
            description="PIN reset authorization requires an administrator role. Contact a super administrator if you need access."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* ── Customer PIN reset ─────────────────────────────────── */}
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <UserRound size={16} aria-hidden="true" /> Customer PIN reset
              </span>
            }
            padded
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Verify the customer by phone or in person first. Never authorize a
              reset from an unverified message.
            </p>

            <form onSubmit={searchCustomers} className="mt-4 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextInput
                  label="Find customer"
                  placeholder="Name or phone number"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button type="submit" variant="secondary" loading={searchBusy}>
                Search
              </Button>
            </form>

            {searchError ? (
              <p role="alert" className="mt-3 text-sm" style={{ color: "var(--error)" }}>
                {searchError}
              </p>
            ) : null}

            {results ? (
              results.length === 0 ? (
                <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
                  No matching customer. Check the spelling or the registered
                  phone number.
                </p>
              ) : (
                <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto" aria-label="Customer results">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(c);
                          setVerified(false);
                          setIssued(null);
                          setIssueError(null);
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          background:
                            selected?.id === c.id ? "var(--primary-soft)" : "transparent",
                          color: "var(--text)",
                        }}
                      >
                        <span className="font-medium">{c.fullName}</span>
                        <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                          {c.phone}
                          {c.state ? ` · ${c.state}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {selected ? (
              <div
                className="mt-5 rounded-xl border p-4"
                style={{ borderColor: "var(--border)" }}
              >
                <p className="text-sm font-semibold">{selected.fullName}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {selected.phone}
                  {selected.email ? ` · ${selected.email}` : ""}
                </p>

                <label className="mt-4 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                  />
                  <span>
                    I verified this customer&apos;s identity outside the app
                    (phone call or in person).
                  </span>
                </label>

                <div className="mt-3">
                  <TextInput
                    label="Verification note (optional)"
                    hint="Record how identity was verified. No PINs or tokens."
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Called registered number, confirmed address"
                  />
                </div>

                {issueError ? (
                  <p role="alert" className="mt-3 text-sm" style={{ color: "var(--error)" }}>
                    {issueError}
                  </p>
                ) : null}

                <Button
                  className="mt-4"
                  onClick={issueToken}
                  loading={issuing}
                  disabled={!verified}
                  icon={<KeyRound size={16} aria-hidden="true" />}
                >
                  Issue one-time reset token
                </Button>
              </div>
            ) : null}

            {issued ? (
              <div
                className="mt-4 rounded-xl border p-4"
                style={{ borderColor: "var(--success)", background: "var(--field)" }}
                role="status"
              >
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck size={16} aria-hidden="true" />
                  Token issued — shown once
                </p>
                <code className="mt-3 block break-all rounded-lg p-3 text-xs" style={{ background: "var(--surface)" }}>
                  {issued.resetToken}
                </code>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <CopyButton value={issued.resetToken} label="Copy token" />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Expires {formatDate(issued.expiresAt)}
                  </span>
                </div>
                <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                  Give this to the customer through the verified channel. It can
                  be used once and cannot be retrieved later.
                </p>
              </div>
            ) : null}
          </Card>

          {/* ── Authorization history ──────────────────────────────── */}
          <Card
            title="Recent authorizations"
            actions={
              <Button variant="ghost" size="sm" onClick={() => void loadResets()}>
                Refresh
              </Button>
            }
            padded
          >
            {resetsError ? (
              <ErrorState title="Could not load history" description={resetsError} />
            ) : resets === null ? (
              <Skeleton height="6rem" />
            ) : resets.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No PIN resets have been authorized yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {resets.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {r.customerId ? (
                          <Link to={`/customers/${r.customerId}`} className="underline">
                            {r.customerName ?? r.customerPhone}
                          </Link>
                        ) : (
                          (r.customerName ?? r.customerPhone)
                        )}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.createdByName ? `By ${r.createdByName} · ` : ""}
                        {formatDate(r.createdAt)} · expires {formatDate(r.expiresAt)}
                      </p>
                      {r.note ? (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.note}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill
                        status={r.status}
                        label={STATUS_LABEL[r.status]}
                        tone={STATUS_TONE[r.status]}
                      />
                      {r.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={revokingId === r.id}
                          onClick={() => void revoke(r.id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ── Staff recovery ────────────────────────────────────────── */}
      {isSuperAdmin ? (
        <Card
          className="mt-6"
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={16} aria-hidden="true" /> Staff password &amp; authenticator
            </span>
          }
          padded
        >
          <div
            className="mb-5 rounded-xl border p-4 text-sm"
            style={{ borderColor: "var(--warning)", background: "var(--field)" }}
          >
            <p className="inline-flex items-center gap-2 font-medium">
              <AlertTriangle size={16} aria-hidden="true" />
              Manual identity verification required
            </p>
            <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
              <strong style={{ color: "var(--text)" }}>Password reset token</strong> (preferred): verify identity, issue a one-time token, and let the staff member set a new password on the sign-in recovery page.{" "}
              <strong style={{ color: "var(--text)" }}>Temporary password</strong>: operator sets a temporary password directly.{" "}
              <strong style={{ color: "var(--text)" }}>Authenticator reset</strong> is separate and clears TOTP for re-enrollment. Password recovery never disables TOTP.
            </p>
          </div>

          {staffError ? (
            <ErrorState title="Could not load staff" description={staffError} />
          ) : staff === null ? (
            <Skeleton height="5rem" />
          ) : otherStaff.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No other staff accounts.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {otherStaff.map((member) => (
                <li key={member.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{member.fullName}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {member.email ?? member.phone} ·{" "}
                        {member.totpEnrolled ? "Authenticator enrolled" : "No authenticator"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={staffBusyId === member.id}
                        onClick={() => void resetStaffPassword(member)}
                      >
                        Issue temporary password
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={staffBusyId === member.id}
                        disabled={!member.totpEnrolled}
                        onClick={() => void resetStaffAuthenticator(member)}
                      >
                        Reset authenticator
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={Boolean(staffVerified[member.id])}
                        onChange={(e) =>
                          setStaffVerified((s) => ({ ...s, [member.id]: e.target.checked }))
                        }
                      />
                      <span>
                        I verified this staff member&apos;s identity outside the app.
                      </span>
                    </label>
                    <div className="mt-2">
                      <TextInput
                        label="Verification note (optional)"
                        hint="Record how identity was verified. No passwords or tokens."
                        maxLength={300}
                        value={staffNote[member.id] ?? ""}
                        onChange={(e) =>
                          setStaffNote((s) => ({ ...s, [member.id]: e.target.value }))
                        }
                        placeholder="e.g. In-person verification with owner"
                      />
                    </div>
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={() => void issueStaffPasswordResetToken(member)}
                      loading={staffBusyId === member.id}
                      disabled={!staffVerified[member.id]}
                      icon={<KeyRound size={14} aria-hidden="true" />}
                    >
                      Issue password reset token
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {staffResult ? (
            <div
              className="mt-5 rounded-xl border p-4"
              style={{ borderColor: "var(--success)", background: "var(--field)" }}
              role="status"
            >
              <p className="text-sm font-semibold">
                {staffResult.kind === "password"
                  ? `Temporary password for ${staffResult.name}`
                  : staffResult.kind === "password-token"
                    ? `Password reset token for ${staffResult.name} — shown once`
                    : `Authenticator cleared for ${staffResult.name}`}
              </p>
              {staffResult.kind === "password" ? (
                <>
                  <code className="mt-3 block break-all rounded-lg p-3 text-sm" style={{ background: "var(--surface)" }}>
                    {staffResult.temporaryPassword}
                  </code>
                  <div className="mt-3">
                    <CopyButton value={staffResult.temporaryPassword} label="Copy password" />
                  </div>
                </>
              ) : null}
              {staffResult.kind === "password-token" ? (
                <>
                  <code className="mt-3 block break-all rounded-lg p-3 text-xs" style={{ background: "var(--surface)" }}>
                    {staffResult.resetToken}
                  </code>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CopyButton value={staffResult.resetToken} label="Copy token" />
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Expires {formatDate(staffResult.expiresAt)}
                    </span>
                  </div>
                </>
              ) : null}
              <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                {staffResult.notice}
              </p>
            </div>
          ) : null}

          <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Recent staff password reset authorizations</h3>
              <Button variant="ghost" size="sm" onClick={() => void loadStaffResets()}>
                Refresh
              </Button>
            </div>
            {staffResetsError ? (
              <ErrorState title="Could not load history" description={staffResetsError} />
            ) : staffResets === null ? (
              <Skeleton height="4rem" />
            ) : staffResets.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No staff password reset tokens have been authorized yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {staffResets.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.staffName ?? r.staffIdentifier}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.createdByName ? `By ${r.createdByName} · ` : ""}
                        {formatDate(r.createdAt)} · expires {formatDate(r.expiresAt)}
                      </p>
                      {r.note ? (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{r.note}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill
                        status={r.status}
                        label={STATUS_LABEL[r.status]}
                        tone={STATUS_TONE[r.status]}
                      />
                      {r.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={revokingStaffResetId === r.id}
                          onClick={() => void revokeStaffPasswordReset(r.id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
