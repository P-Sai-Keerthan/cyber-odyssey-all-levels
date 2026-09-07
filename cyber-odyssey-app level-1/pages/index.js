import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import OdysseusGuide from "../components/OdysseusGuide";
import { portalLevel1Url } from "../lib/portalLink";

export default function Home() {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [eventPhase, setEventPhase] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/event/status");
        const data = await res.json();
        if (!cancelled) setEventPhase(data.event?.phase || null);
      } catch {
        // ignore transient network errors, next poll will retry
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const entryQuery = router.query.entry;
  const entryMessages = {
    // Emitted by /api/enter when the link carries no ticket at all — usually a
    // bookmarked or hand-typed /api/enter URL rather than a real launch.
    missing:
      "That link did not carry a Level 1 entry ticket. Open Level 1 from your Portal dashboard so a fresh one is issued.",
    expired: "Your Level 1 entry ticket has expired. Please return to the Portal to generate a fresh entry link.",
    used: "This Level 1 entry ticket has already been used. Each ticket is single-use for security. Return to the Portal to enter again.",
    closed: "Level 1 is not currently open on the Portal. Check the event schedule.",
    invalid: "The Level 1 entry ticket was invalid or could not be verified. Please launch Level 1 from your Portal dashboard.",
    error: "Unable to enter Level 1 due to a server communication error. Please try again from the Portal.",
    unavailable: "The Level 1 integration bridge is not configured. Please notify an event marshal.",
  };
  const entryAlert = entryQuery ? (entryMessages[entryQuery] || "Unable to enter Level 1. Please try again from the Portal.") : null;

  // If the browser still carries a valid session cookie, skip login form (only if no explicit entry error)
  useEffect(() => {
    if (router.query.entry) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team/state");
        if (res.ok && !cancelled) router.replace("/hub");
      } catch {
        // no session, stay on login form
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, router.query.entry]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/team/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid team name or password.");
        setLoading(false);
        return;
      }
      router.push("/hub");
    } catch {
      setError("Couldn't reach the server. Try again.");
      setLoading(false);
    }
  }

  const isSubmitDisabled = loading || !teamName.trim() || !password.trim();

  return (
    <div className="shell">
      <Head>
        <title>Cyber Odyssey &mdash; Team Login</title>
      </Head>
      <main className="center">
        <div className="hero">
          <div className="eyebrow">Level 1 &middot; Qualification Voyage</div>
          <h1>CYBER ODYSSEY</h1>
          <div style={{ fontSize: "1.2rem", fontWeight: 700, letterSpacing: "3px", color: "var(--accent, #38bdf8)", marginTop: "-0.4rem", marginBottom: "1rem" }}>
            LEVEL 1
          </div>
          <p className="sub">
            Troy is behind you. Ithaca is close. Between your crew and
            home lie trials that have wrecked braver ships than yours &mdash;
            pass them, and the way home reveals itself.
          </p>

          <form onSubmit={handleSubmit} className="card" style={{ textAlign: "left" }}>
            <div className="eyebrow" style={{ color: "var(--accent)", marginBottom: "0.25rem" }}>
              LEVEL 1
            </div>
            <h2 className="stage-title" style={{ fontSize: "1.3rem", marginTop: 0, marginBottom: "0.4rem", letterSpacing: "0.5px" }}>
              Team Login
            </h2>
            <p className="stage-copy" style={{ margin: "0 0 1.2rem", fontSize: "0.9rem", opacity: 0.9 }}>
              WELCOME ABOARD, CAPTAIN. Enter your team credentials below when your crew is ready.
            </p>

            {entryAlert && (
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  borderRadius: "8px",
                  padding: "0.9rem 1rem",
                  marginBottom: "1.2rem",
                  color: "#fca5a5",
                  fontSize: "0.88rem",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: "0.3rem", color: "#f87171" }}>
                  Entry Alert
                </div>
                <p style={{ margin: "0 0 0.8rem", lineHeight: 1.4 }}>{entryAlert}</p>
                <a
                  href={portalLevel1Url()}
                  style={{
                    display: "inline-block",
                    background: "var(--accent, #38bdf8)",
                    color: "#000",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    padding: "0.4rem 0.8rem",
                    borderRadius: "4px",
                    textDecoration: "none",
                  }}
                >
                  Return to Portal Dashboard →
                </a>
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <label htmlFor="teamName" style={{ fontWeight: 600, letterSpacing: "0.5px" }}>Team Name</label>
              <input
                id="teamName"
                type="text"
                placeholder="Enter team name"
                autoComplete="organization"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: "1.2rem" }}>
              <label htmlFor="teamPassword" style={{ fontWeight: 600, letterSpacing: "0.5px" }}>
                Password <span style={{ color: "var(--muted)", fontSize: "0.85rem", fontWeight: 400 }}>(Team Password)</span>
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  id="teamPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter team password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: "2.75rem", width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    right: "0.5rem",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "0.35rem",
                    color: "var(--muted, #94a3b8)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                  }}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button className="btn" type="submit" style={{ width: "100%", letterSpacing: "1px" }} disabled={isSubmitDisabled}>
              {loading ? "Logging in..." : "LOGIN / ENTER LEVEL 1"}
            </button>

            {error && <p className="error-text" style={{ marginTop: "0.8rem", marginBottom: 0 }}>{error}</p>}

            {eventPhase === "not_started" && (
              <p className="stage-copy" style={{ marginTop: "1rem", marginBottom: 0, fontSize: "0.85rem", opacity: 0.85 }}>
                The winds haven't risen yet &mdash; you can log in now
                and wait here. The voyage begins the moment the organizers
                release the fleet.
              </p>
            )}
          </form>
        </div>
      </main>
      <OdysseusGuide stage="landing" />
    </div>
  );
}
