import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton, useToast } from "@togi/ui";
import type { StaffMember } from "@togi/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { disablePush, enablePush, getPushPermission, isPushSupported, syncPushState } from "../lib/push";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
      <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="text-sm font-medium text-right break-all">{value || "—"}</dd>
    </div>
  );
}

export default function Settings() {
  const { user, logout, refresh } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushState, setPushState] = useState<{
    supported: boolean;
    permission: NotificationPermission | "unsupported";
    subscribed: boolean;
  }>({ supported: isPushSupported(), permission: getPushPermission(), subscribed: false });

  const isSuperAdmin = useMemo(() => Boolean(user?.roles?.includes("super_admin")), [user?.roles]);

  useEffect(() => {
    setFullName(user?.fullName ?? "");
    setPhone(user?.phone ?? "");
    setEmail(user?.email ?? "");
  }, [user?.fullName, user?.phone, user?.email]);

  const loadStaff = useCallback(async () => {
    if (!isSuperAdmin) return;
    setStaffLoading(true);
    try {
      const res = await api<{ staff: StaffMember[] }>("/admin/staff");
      setStaff(res.staff);
      setStaffError(null);
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : "Could not load admin accounts.");
      setStaff(null);
    } finally {
      setStaffLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const refreshPush = useCallback(async () => {
    try {
      setPushState(await syncPushState());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshPush();
  }, [refreshPush]);

  async function onEnablePush() {
    setPushBusy(true);
    try {
      const res = await enablePush();
      await refreshPush();
      toast({
        message:
          res.message ??
          (res.ok ? "Browser notifications enabled." : "Could not enable browser notifications."),
        tone: res.ok ? "success" : "error",
      });
    } catch (e) {
      await refreshPush();
      toast({
        message: e instanceof Error ? e.message : "Could not enable browser notifications.",
        tone: "error",
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function onDisablePush() {
    setPushBusy(true);
    try {
      const res = await disablePush();
      await refreshPush();
      toast({
        message:
          res.message ??
          (res.ok ? "Browser notifications disabled." : "Could not disable browser notifications."),
        tone: res.ok ? "success" : "error",
      });
    } catch (e) {
      await refreshPush();
      toast({
        message: e instanceof Error ? e.message : "Could not disable browser notifications.",
        tone: "error",
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api("/auth/staff/profile", {
        method: "PATCH",
        body: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
        },
      });
      await refresh();
      toast({ message: "Profile updated.", tone: "success" });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Could not update profile.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (changingPassword) return;
    if (
      newPassword.length < 8 ||
      !/[a-zA-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      toast({
        message: "Use at least 8 characters, including a letter and a number.",
        tone: "error",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ message: "New password confirmation does not match.", tone: "error" });
      return;
    }
    setChangingPassword(true);
    try {
      await api("/auth/staff/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        message: "Password changed. Other devices have been signed out.",
        tone: "success",
      });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Could not change password.",
        tone: "error",
      });
    } finally {
      setChangingPassword(false);
    }
  }

  async function removeStaff(member: StaffMember) {
    if (member.id === user?.id) return;
    const label = member.email || member.phone || member.fullName;
    const ok = window.confirm(
      `Permanently delete the admin/staff account for ${member.fullName} (${label})? Access will be revoked and this action cannot be undone. The account's email/phone details can be used to create a new account afterward.`,
    );
    if (!ok) return;
    setDeletingId(member.id);
    try {
      await api(`/admin/staff/${member.id}`, { method: "DELETE" });
      toast({ message: "Account permanently deleted.", tone: "success" });
      await loadStaff();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError ? err.message : "Could not permanently delete account.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Manage your admin profile and account information.
        </p>
      </div>

      <Card className="mt-6" padded title="Account information">
        <dl className="divide-y divide-[var(--border)]">
          <Row label="Full name" value={user?.fullName ?? "—"} />
          <Row label="Phone number" value={user?.phone ?? "—"} />
          <Row label="Email" value={user?.email ?? "—"} />
          <Row label="Roles" value={user?.roles?.length ? user.roles.join(", ") : "—"} />
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <Link to="/add-admin" className="t-btn t-btn--secondary t-btn--sm">
            Add another admin
          </Link>
        </div>
      </Card>

      {isSuperAdmin ? (
        <Card className="mt-5" padded title="Admin accounts">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Admin and staff accounts created for this console. You can review details and permanently delete accounts when needed (deleted account email/phone details can be reused for a new account).
          </p>

          <div className="mt-4">
            {staffLoading && staff === null ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} height="4rem" />
                ))}
              </div>
            ) : staffError && staff === null ? (
              <ErrorState
                title="Couldn't load admin accounts"
                description={staffError}
                action={
                  <Button variant="secondary" onClick={() => void loadStaff()}>
                    Try again
                  </Button>
                }
              />
            ) : staff && staff.length === 0 ? (
              <EmptyState
                title="No admin accounts found"
                description="Accounts you create will appear here."
                action={
                  <Link to="/add-admin" className="t-btn t-btn--primary t-btn--sm">
                    Add another admin
                  </Link>
                }
              />
            ) : staff ? (
              <ul className="divide-y divide-[var(--border)]">
                {staff.map((member) => {
                  const isSelf = member.id === user?.id;
                  return (
                    <li key={member.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {member.fullName}
                            {isSelf ? (
                              <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                                (You)
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 break-all text-xs" style={{ color: "var(--text-muted)" }}>
                            {member.email ?? "—"}
                            {member.phone ? ` · ${member.phone}` : ""}
                          </p>
                          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                            Roles: {member.roles?.length ? member.roles.join(", ") : "—"}
                            {member.lastLoginAt ? ` · last sign-in ${new Date(member.lastLoginAt).toLocaleString()}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isSelf ? (
                            <Button
                              variant="danger"
                              size="sm"
                              loading={deletingId === member.id}
                              onClick={() => void removeStaff(member)}
                            >
                              Permanently delete
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card className="mt-5" padded title="Browser notifications">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Receive browser push alerts for new refill requests and key operational updates on this device.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              {pushState.subscribed ? <Bell size={16} /> : <BellOff size={16} />}
              {pushState.subscribed ? "Notifications enabled" : "Enable notifications"}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {!pushState.supported
                ? "This browser/device does not support push notifications."
                : pushState.permission === "denied"
                  ? "Notifications are blocked in browser settings for this site."
                  : pushState.subscribed
                    ? "Browser push is active on this browser. You can disable it here; in-app notifications remain available."
                    : pushState.permission === "granted"
                      ? "Browser permission is granted, but notifications have not yet been activated on this browser."
                      : "Enable notifications when you want alerts (permission will be requested by your browser)."}
            </p>
          </div>
          <div>
            {pushState.supported && pushState.permission !== "denied" ? (
              pushState.subscribed ? (
                <Button variant="secondary" size="sm" loading={pushBusy} onClick={() => void onDisablePush()}>
                  Disable notifications
                </Button>
              ) : (
                <Button size="sm" loading={pushBusy} onClick={() => void onEnablePush()}>
                  Enable notifications
                </Button>
              )
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="mt-5" padded title="Change password">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          After an operator-issued temporary password, set your own password
          here. Your authenticator stays enrolled and is still required at
          sign-in. Other signed-in devices are signed out.
        </p>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
              Current password
            </span>
            <input
              className="t-input w-full"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
              New password
            </span>
            <input
              className="t-input w-full"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
              placeholder="At least 8 characters, with a letter and a number"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
              Confirm new password
            </span>
            <input
              className="t-input w-full"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <div className="pt-1">
            <Button type="submit" loading={changingPassword}>
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5" padded title="Edit profile">
        <form onSubmit={saveProfile} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Full name</span>
            <input
              className="t-input w-full"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              minLength={2}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Phone number</span>
            <input
              className="t-input w-full"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="0803 000 0000"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Email</span>
            <input
              className="t-input w-full"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" loading={saving}>Save changes</Button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Are you sure you want to sign out?")) {
                  void logout();
                }
              }}
              className="text-sm font-medium underline underline-offset-4"
              style={{ color: "var(--accent-text)" }}
            >
              Sign out of this device
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
