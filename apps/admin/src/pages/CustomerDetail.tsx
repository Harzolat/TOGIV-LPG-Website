import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { usePolling } from "../lib/usePolling";
import { Button, Card, ErrorState, Skeleton, StatusPill, useToast } from "@togi/ui";
import type { CustomerDetail as CustomerDetailPayload } from "@togi/shared";

/**
 * Customer detail — the directory's drill-down. Read-only: identity,
 * addresses, registered cylinders and the last ten requests/claims, so an
 * operator can answer "what does this customer actually have with us?"
 * without leaving the console. Writes stay behind the (unshipped)
 * customer:edit/suspend workflows.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
      <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState<CustomerDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setData(await api<CustomerDetailPayload>(`/customers/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this customer.");
    }
  }, [id]);

  usePolling(load, { intervalMs: 15_000 });

  async function removeCustomer() {
    if (!id || !data) return;
    const label = data.email || data.phone || data.fullName;
    const ok = window.confirm(
      `Permanently delete customer ${data.fullName} (${label})? Access will be revoked and this action cannot be undone. The account's email/phone details can be used to create a new account afterward.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await api(`/customers/${id}`, { method: "DELETE" });
      toast({ message: "Customer permanently deleted.", tone: "success" });
      navigate("/customers", { replace: true });
    } catch (err) {
      toast({
        message:
          err instanceof ApiError ? err.message : "Could not permanently delete customer.",
        tone: "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/customers" className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Back to customers
      </Link>

      {error && !data ? (
        <ErrorState
          title="Couldn't open this customer"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <div className="mt-6 space-y-3">
          <Skeleton width="14rem" height="1.75rem" />
          <Skeleton height="4rem" />
          <Skeleton height="10rem" />
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{data.fullName}</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {data.email ?? data.phone ?? "—"}
                {data.email && data.phone ? ` · ${data.phone}` : ""}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                Customer since {formatDate(data.createdAt)}
                {data.state ? ` · ${data.state}${data.lga ? `, ${data.lga}` : ""}` : ""}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {data.status ? <StatusPill status={data.status} /> : null}
              {data.suspendedAt ? (
                <span className="text-xs" style={{ color: "var(--error)" }}>
                  Suspended {formatDate(data.suspendedAt)}
                </span>
              ) : null}
              <Button variant="danger" size="sm" loading={deleting} onClick={() => void removeCustomer()}>
                Permanently delete
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card padded title="Profile">
              <dl className="divide-y divide-[var(--border)]">
                <Row label="Phone" value={data.phone ?? "—"} />
                <Row label="Email" value={data.email ?? "—"} />
                <Row label="Preferred contact" value={data.preferredContact ?? "sms"} />
                <Row label="Marketing consent" value={data.marketingConsent ? "Yes" : "No"} />
                <Row label="Requests" value={String(data.requestCount ?? data.requests.length)} />
              </dl>
            </Card>

            <Card padded title="Addresses">
              {data.addresses.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No delivery address on file.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.addresses.map((a) => (
                    <li key={a.id}>
                      <p className="text-sm font-medium">
                        {a.label}
                        {a.isDefault ? (
                          <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--primary)" }}>
                            default
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} ({a.lga})
                      </p>
                      {a.deliveryNote ? (
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          Note: {a.deliveryNote}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="mt-5" padded title="Cylinders">
            {data.cylinders.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No cylinders registered to this customer.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.cylinders.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-semibold">
                        {c.serial ?? c.label ?? "Unserialised"}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {c.capacityKg ? `${c.capacityKg} kg` : "Capacity not set"}
                        {c.label && c.serial ? ` · ${c.label}` : ""}
                      </span>
                    </span>
                    <StatusPill status={c.condition} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-5" padded title="Recent requests">
            {data.requests.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No requests yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/requests/${r.id}`}
                      className="flex items-center justify-between gap-4 py-2.5 transition-opacity hover:opacity-80"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold">{r.reference}</span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.type} · {formatDate(r.createdAt)}
                        </span>
                      </span>
                      <StatusPill status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>


        </>
      )}
    </div>
  );
}
