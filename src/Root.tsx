import { useCallback, useEffect, useState } from "react";
import { App } from "./App";
import { api } from "./api";
import { LoginScreen } from "./components/LoginScreen";

type Gate = "checking" | "signed-out" | "open" | "signed-in";

/**
 * Asks the server whether a password is required before showing the app, so nothing
 * (and no API call) runs behind the login. With no APP_PASSWORD set the app opens straight away.
 */
export function Root() {
  const [gate, setGate] = useState<Gate>("checking");
  const [problem, setProblem] = useState<string | null>(null);

  const check = useCallback(() => {
    setProblem(null);
    api.authStatus().then(
      (status) => setGate(!status.required ? "open" : status.authenticated ? "signed-in" : "signed-out"),
      (error) => {
        setGate("checking");
        setProblem(error instanceof Error ? error.message : "Couldn't reach the server.");
      },
    );
  }, []);

  useEffect(check, [check]);
  useEffect(() => {
    const onExpired = () => setGate("signed-out");
    window.addEventListener("pb-auth-required", onExpired);
    return () => window.removeEventListener("pb-auth-required", onExpired);
  }, []);

  if (gate === "checking") {
    return problem ? (
      <main className="shell login-wrap">
        <div className="login-card" role="alert">
          <h1 className="login-title">Can't reach the server</h1>
          <p className="modal-copy">{problem}</p>
          <button className="deploy-submit" type="button" onClick={check}>
            Try again
          </button>
        </div>
      </main>
    ) : null;
  }
  if (gate === "signed-out") return <LoginScreen onSignedIn={() => setGate("signed-in")} />;
  return (
    <App
      key={gate}
      onSignOut={
        gate === "signed-in"
          ? () => {
              void api.logout().finally(() => setGate("signed-out"));
            }
          : undefined
      }
    />
  );
}
