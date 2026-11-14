import { useCallback, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePolling } from "../lib/usePolling";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from "@togi/ui";
import type { StaffMember } from "@togi/shared";

interface Role {
  key: string;
  label: string;
  description: string | null;
}

const STAFF_ROLES = ["super_admin", "admin", "agent", "delivery"] as const;

export default function Team() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [roleKey, setRoleKey] = useState("agent");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [staffRes, rolesRes] = await Promise.all([
        api<{ staff: StaffMember[] }>("/admin/staff"),
        api<{ roles: Role[] }>("/admin/roles"),
      ]);
      setStaff(staffRes.staff);
      setRoles(rolesRes.roles);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load staff accounts.",
      );
    }
  }, []);

  usePolling(load, { intervalMs: 20_000 });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (password.length < 8) {
      toast({
        message: "Set a temporary password of at least 8 characters.",
        tone: "error",
      });
      return;
    }
    setSaving(true);
    try {
      await api("/admin/staff", {
        method: "POST",
        body: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          department: department.trim() || null,
          roleKeys: [roleKey],
          password,
        },
      });
      toast({ message: "Staff account created.", tone: "success" });
      setFullName("");
      setPhone("");
      setEmail("");
      setDepartment("");
      setRoleKey("agent");
      setPassword("");
      await load();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError
            ? err.message
            : "Could not create the staff account.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeStaff(member: StaffMember) {
    if (member.id === user?.id) return;
    const ok = window.confirm(`Delete staff account for ${member.fullName} (${member.phone})? This will revoke access.`);
    if (!ok) return;
    setDeletingId(member.id);
    try {
      await api(`/admin/staff/${member.id}`, { method: "DELETE" });
      toast({ message: "Staff account deleted.", tone: "success" });
      await load();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Could not delete staff account.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  const roleOptions = (roles ?? STAFF_ROLES.map((k) => ({ key: k, label: k, description: null }))).filter(
    (r) => r.key !== "customer",
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Create staff accounts. Each person signs in with their password and
          sets up two-factor authentication on first login.
        </p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card padded title="Create staff account">
          <form onSubmit={create} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                Full name
              </span>
              <input
                className="t-input w-full"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                Phone number
              </span>
              <input
                className="t-input w-full"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="0803 000 0000"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                Email (optional)
              </span>
              <input
                className="t-input w-full"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                Department (optional)
              </span>
              <input
                className="t-input w-full"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                Role
              </span>
              <select
                className="t-input w-full"
                value={roleKey}
                onChange={(e) => setRoleKey(e.target.value)}
              >
                {roleOptions.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.label} ({role.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                Temporary password
              </span>
              <input
                className="t-input w-full"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                At least 8 characters. The person will be asked to set up TOTP on
                first sign-in.
              </span>
            </label>
            <Button type="submit" loading={saving}>
              Create staff account
            </Button>
          </form>
        </Card>

        <Card padded title="Staff accounts">
          {error && staff === null ? (
            <ErrorState
              title="Couldn't load staff"
              description={error}
              action={
                <Button variant="secondary" onClick={() => void load()}>
                  Try again
                </Button>
              }
            />
          ) : staff === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height="3.5rem" />
              ))}
            </div>
          ) : staff.length === 0 ? (
            <EmptyState
              title="No staff accounts"
              description="Create an account for each team member who needs access."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {staff.map((member) => (
                <li key={member.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{member.fullName}</p>
                      <p
                        className="mt-0.5 break-all text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {member.phone}
                        {member.email ? ` · ${member.email}` : ""}
                        {member.department ? ` · ${member.department}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {member.roles.join(", ") || "—"}
                      </span>
                      {member.id !== user?.id ? (
                        <Button
                          variant="danger"
                          size="sm"
                          loading={deletingId === member.id}
                          onClick={() => void removeStaff(member)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    2FA: {member.totpEnrolled ? "enabled" : "not set up yet"}
                    {member.lastLoginAt
                      ? ` · last sign-in ${new Date(member.lastLoginAt).toLocaleString()}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
