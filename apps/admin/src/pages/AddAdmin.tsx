import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, useToast } from "@togi/ui";
import { api, ApiError } from "../lib/api";

export default function AddAdmin() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<"admin" | "super_admin">("admin");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (password.length < 8) {
      toast({ message: "Set a temporary password of at least 8 characters.", tone: "error" });
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
          roleKeys: [roleKey],
          password,
        },
      });
      toast({ message: "Admin account created.", tone: "success" });
      navigate("/settings");
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Could not create the admin account.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div>
        <Link to="/settings" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← Back to settings
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Add another admin</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Create an admin account. The person will sign in with this password and complete two-factor authentication on first login.
        </p>
      </div>

      <Card className="mt-6" padded>
        <form onSubmit={create} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Full name</span>
            <input
              className="t-input w-full"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
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
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Email (optional)</span>
            <input
              className="t-input w-full"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Role</span>
            <select
              className="t-input w-full"
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value as "admin" | "super_admin")}
            >
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>Temporary password</span>
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
              At least 8 characters.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" loading={saving}>Create admin account</Button>
            <Link to="/settings" className="t-btn t-btn--ghost t-btn--md">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
