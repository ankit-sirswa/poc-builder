import { useState, type FormEvent } from "react";
import { api } from "../api";

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter the password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in. Please retry.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-mark">d</span>
        <h1 className="login-title">Sign in to draftwork</h1>
        <p className="modal-copy">This workspace is password protected.</p>
        <label className="field-label" htmlFor="appPassword">
          Password
        </label>
        <input className="text-input" id="appPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? "loginError" : undefined} />
        {error && (
          <p className="field-error is-visible" id="loginError" role="alert">
            {error}
          </p>
        )}
        <button className="deploy-submit" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
