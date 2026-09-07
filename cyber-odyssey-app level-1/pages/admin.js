import { useEffect, useState, useCallback, useMemo } from "react";
import Head from "next/head";

const POLL_MS = 5000;

function formatMs(ms) {
  if (ms === null || ms === undefined || ms < 0) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Admin() {
  const [authed, setAuthed] = useState(null); // null = checking, false = need login, true = in
  const [password, setPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [savedMsg, setSavedMsg] = useState("");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  // Search filter for teams table
  const [searchFilter, setSearchFilter] = useState("");
  const [durationInput, setDurationInput] = useState("45");
  const [durationMsg, setDurationMsg] = useState("");
  const [teamResetMsg, setTeamResetMsg] = useState("");

  // Client-side ticking countdown between 5s server polls
  const [localMsRemaining, setLocalMsRemaining] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/status");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (res.ok) {
        setAuthed(true);
        const data = await res.json();
        setStatus(data);
        if (data.event?.msRemaining !== null && data.event?.msRemaining !== undefined) {
          setLocalMsRemaining(data.event.msRemaining);
        }
        if (data.event?.durationMinutes) {
          setDurationInput(String(data.event.durationMinutes));
        }
      }
    } catch {
      // transient network hiccup
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!authed) return;
    loadConfig();
    const id = setInterval(loadStatus, POLL_MS);
    return () => clearInterval(id);
  }, [authed, loadStatus, loadConfig]);

  // Local ticker for live remaining countdown
  useEffect(() => {
    if (status?.event?.phase !== "running" || localMsRemaining === null) return;
    const ticker = setInterval(() => {
      setLocalMsRemaining((prev) => (prev !== null && prev > 1000 ? prev - 1000 : 0));
    }, 1000);
    return () => clearInterval(ticker);
  }, [status?.event?.phase, localMsRemaining]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginError("Wrong password.");
      return;
    }
    setAuthed(true);
    loadStatus();
  }

  async function handleSetState(action) {
    let confirmMsg = "";
    if (action === "open") confirmMsg = "Open and start the event clock for all crews?";
    if (action === "pause") confirmMsg = "Pause the event? Timer will freeze and submissions will be locked.";
    if (action === "resume") confirmMsg = "Resume the event? Timer and submissions will unlock.";
    if (action === "end") confirmMsg = "End the event immediately for all crews?";

    if (confirmMsg && !confirm(confirmMsg)) return;

    try {
      const res = await fetch("/api/admin/set-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        loadStatus();
      }
    } catch (err) {
      alert("Failed to update event state: " + err.message);
    }
  }

  async function handleSaveDuration(e) {
    e.preventDefault();
    setDurationMsg("");
    const minutes = parseInt(durationInput, 10);
    if (isNaN(minutes) || minutes < 1) {
      setDurationMsg("Enter a valid duration in minutes.");
      return;
    }

    try {
      const res = await fetch("/api/admin/set-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMinutes: minutes }),
      });
      if (res.ok) {
        setDurationMsg("Duration saved.");
        setTimeout(() => setDurationMsg(""), 2500);
        loadStatus();
      }
    } catch {
      setDurationMsg("Failed to save duration.");
    }
  }

  async function handleResetTeam(team) {
    const promptText = `Reset progress for ${team.name || team.code} (${team.code})?\n\nThis wipes all answers, attempts, hints, and checkpoints for this team. Their name and credentials will be kept.`;
    if (!confirm(promptText)) return;

    setTeamResetMsg("");
    try {
      const res = await fetch("/api/admin/reset-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: team.code }),
      });
      const data = await res.json();
      if (res.ok) {
        setTeamResetMsg(`✓ ${team.name || team.code} progress reset to fresh.`);
        setTimeout(() => setTeamResetMsg(""), 3500);
        loadStatus();
      } else {
        alert(data.message || "Failed to reset team.");
      }
    } catch (err) {
      alert("Error resetting team: " + err.message);
    }
  }

  async function handleSaveConfig(e) {
    e.preventDefault();
    await fetch("/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSavedMsg("Saved.");
    setTimeout(() => setSavedMsg(""), 2000);
  }

  async function handleResetEvent() {
    if (resetConfirmText !== "RESET") return;
    if (!confirm("This wipes EVERY team's progress and resets the event clock to Not Started. Are you sure?")) return;
    setResetBusy(true);
    setResetMsg("");
    const res = await fetch("/api/admin/reset-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: resetConfirmText }),
    });
    setResetBusy(false);
    if (!res.ok) {
      setResetMsg("Something went wrong — nothing was reset.");
      return;
    }
    setResetConfirmText("");
    setResetMsg("Done — every team is back to a fresh start, and the event clock is cleared.");
    loadStatus();
  }

  const filteredStandings = useMemo(() => {
    const list = status?.standings || [];
    if (!searchFilter.trim()) return list;
    const q = searchFilter.toLowerCase().trim();
    return list.filter(
      (t) =>
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.code && t.code.toLowerCase().includes(q))
    );
  }, [status?.standings, searchFilter]);

  if (authed === null) {
    return (
      <div className="shell">
        <main className="center"><p className="stage-copy">Loading...</p></main>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="shell">
        <Head><title>Cyber Odyssey &mdash; Level 1 Fleet Command</title></Head>
        <main className="center">
          <form onSubmit={handleLogin} className="card" style={{ maxWidth: 400, width: "100%", textAlign: "center", padding: "2.5rem 2rem" }}>
            <div className="eyebrow" style={{ color: "var(--accent)", letterSpacing: "0.15em", marginBottom: "0.4rem" }}>
              LEVEL 1 ADMIN
            </div>
            <h1 className="stage-title" style={{ margin: "0.2rem 0 0.4rem", fontSize: "1.8rem", lineHeight: 1.2 }}>
              FLEET COMMAND<br />LOGIN
            </h1>
            <p className="stage-copy" style={{ color: "var(--muted)", margin: "0 0 1.8rem", fontSize: "0.9rem" }}>
              Administrator Access
            </p>

            <div style={{ textAlign: "left", marginBottom: "1.2rem" }}>
              <label htmlFor="pw" style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.75rem", letterSpacing: "0.08em", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                ADMIN PASSWORD
              </label>
              <div style={{ position: "relative", width: "100%" }}>
                <input
                  id="pw"
                  type={showAdminPassword ? "text" : "password"}
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: "100%", paddingRight: "3rem", boxSizing: "border-box" }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword((prev) => !prev)}
                  aria-label={showAdminPassword ? "Hide password" : "Show password"}
                  title={showAdminPassword ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    right: "0.75rem",
                    top: "50%",
                    transform: "translateY(-50%)",
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
                  {showAdminPassword ? (
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

            <button className="btn" type="submit" style={{ width: "100%", padding: "0.75rem 1rem", fontWeight: 700, letterSpacing: "0.08em" }}>
              ENTER
            </button>

            {loginError && <p className="error-text" style={{ marginTop: "1rem" }}>{loginError}</p>}

            <p style={{ marginTop: "1.8rem", marginBottom: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
              Authorized Level 1 event administrators only.
            </p>
          </form>
        </main>
      </div>
    );
  }

  const phase = status?.event?.phase || "not_started";
  const phaseLabel = {
    not_started: "NOT STARTED",
    running: "OPEN / RUNNING",
    paused: "PAUSED",
    ended: "ENDED",
  }[phase] || phase.toUpperCase();

  const phaseColor = {
    not_started: "var(--muted)",
    running: "var(--good)",
    paused: "var(--warn)",
    ended: "var(--critical)",
  }[phase] || "var(--ink)";

  return (
    <div className="shell">
      <Head><title>Cyber Odyssey &mdash; Level 1 Fleet Command</title></Head>
      <div className="topbar">
        <span className="stage-tag">Fleet Command &bull; Level 1 Admin</span>
        <span className="team-code" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <span style={{ color: phaseColor, fontWeight: 700 }}>● {phaseLabel}</span>
          <span className="mono" style={{ color: "var(--ink)", background: "rgba(0,0,0,0.3)", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
            {formatMs(localMsRemaining)}
          </span>
        </span>
      </div>

      <div className="container-wide">
        <div style={{ marginBottom: "1.8rem" }}>
          <div className="eyebrow" style={{ color: "var(--accent)", letterSpacing: "0.15em", marginBottom: "0.25rem" }}>
            FLEET COMMAND
          </div>
          <h1 className="stage-title" style={{ margin: 0, fontSize: "1.9rem" }}>
            LEVEL 1 ADMIN DASHBOARD
          </h1>
        </div>

        {/* 1. EVENT CONTROL */}
        <div className="card" style={{ maxWidth: "none", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h2 className="stage-title" style={{ margin: "0 0 0.3rem" }}>1. EVENT CONTROL</h2>
              <p className="stage-copy" style={{ margin: 0, fontSize: "0.9rem" }}>
                Status: <strong style={{ color: phaseColor }}>{phaseLabel}</strong>
                {status?.event?.startAt && (
                  <span> &bull; Started at {new Date(status.event.startAt).toLocaleTimeString()}</span>
                )}
                {status?.event?.endAt && (
                  <span> &bull; Ends at {new Date(status.event.endAt).toLocaleTimeString()}</span>
                )}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
              {(phase === "not_started" || phase === "ended") && (
                <button
                  type="button"
                  className="btn"
                  style={{ background: "var(--good)", color: "#0a1420", fontWeight: 700 }}
                  onClick={() => handleSetState("open")}
                >
                  START EVENT
                </button>
              )}

              {phase === "running" && (
                <>
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "var(--warn)", color: "#0a1420", fontWeight: 700 }}
                    onClick={() => handleSetState("pause")}
                  >
                    PAUSE EVENT
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "var(--critical)", color: "#fff", fontWeight: 700 }}
                    onClick={() => handleSetState("end")}
                  >
                    END EVENT
                  </button>
                </>
              )}

              {phase === "paused" && (
                <>
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "var(--good)", color: "#0a1420", fontWeight: 700 }}
                    onClick={() => handleSetState("resume")}
                  >
                    RESUME EVENT
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "var(--critical)", color: "#fff", fontWeight: 700 }}
                    onClick={() => handleSetState("end")}
                  >
                    END EVENT
                  </button>
                </>
              )}
            </div>
          </div>

          <hr style={{ borderColor: "rgba(255,255,255,0.08)", margin: "1.2rem 0" }} />

          {/* Event Duration Setting */}
          <form onSubmit={handleSaveDuration} style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
            <label htmlFor="ev-dur" style={{ margin: 0, fontWeight: 600 }}>Event Duration:</label>
            <input
              id="ev-dur"
              type="number"
              min="1"
              max="240"
              style={{ width: "90px" }}
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
            />
            <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>minutes</span>
            <button className="btn secondary" type="submit" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
              SAVE DURATION
            </button>
            {durationMsg && <span className="success-text" style={{ fontSize: "0.9rem" }}>{durationMsg}</span>}
          </form>
        </div>

        {/* 2. EVENT STATISTICS */}
        <div style={{ marginBottom: "1.5rem" }}>
          {/* Row 1: Registered Crews | Completed */}
          <div className="stats-grid-row-1">
            <StatTile label="Registered Crews" value={status?.summary?.totalTeams ?? "-"} />
            <StatTile label="Completed" value={status?.summary?.completed ?? "-"} />
          </div>
          {/* Row 2: On Track A | On Track C | On Track B */}
          <div className="stats-grid-row-2">
            <StatTile label="On Track A" value={status?.summary?.onTrackA ?? "-"} />
            <StatTile label="On Track C" value={status?.summary?.onTrackC ?? "-"} />
            <StatTile label="On Track B" value={status?.summary?.onTrackB ?? "-"} />
          </div>
        </div>

        {/* 2. LIVE LEADERBOARD */}
        <div className="card" style={{ maxWidth: "none", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <h2 className="stage-title" style={{ margin: "0 0 0.2rem" }}>2. LIVE LEADERBOARD</h2>
              <p className="stage-copy" style={{ margin: 0, fontSize: "0.85rem" }}>
                Admin-only view &bull; Ranked by Total Score DESC &rarr; Finish Time ASC &rarr; Attempts ASC &rarr; Team ID ASC &bull; Teams with 0 pts shown as unranked (&mdash;) &bull; Auto-refreshes every 5s
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
              <input
                type="text"
                placeholder="Filter by crew or code..."
                style={{ width: "240px", fontSize: "0.9rem" }}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              {searchFilter && (
                <button
                  type="button"
                  className="btn secondary"
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                  onClick={() => setSearchFilter("")}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {teamResetMsg && (
            <p className="success-text" style={{ margin: "0 0 1rem" }}>{teamResetMsg}</p>
          )}

          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>RANK</th>
                  <th>TEAM NAME</th>
                  <th>TEAM CODE</th>
                  <th>TRACK A</th>
                  <th>TRACK B</th>
                  <th>TRACK C</th>
                  <th>TOTAL SCORE</th>
                  <th>FINISH TIME</th>
                  <th>TRACK A ATTEMPTS</th>
                  <th>TRACK B ATTEMPTS</th>
                  <th>TRACK C ATTEMPTS</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredStandings.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
                      {searchFilter ? `No teams match "${searchFilter}".` : "No teams registered yet."}
                    </td>
                  </tr>
                ) : (
                  filteredStandings.map((t) => (
                    <tr key={t.code}>
                      <td className="mono" style={{ fontWeight: 700, textAlign: "center" }}>
                        {t.rank === "—" || t.totalPoints === 0 ? "—" : t.rank}
                      </td>
                      <td style={{ fontWeight: 600 }}>{t.name || `Crew ${t.id}`}</td>
                      <td className="mono">{t.code}</td>
                      <td className="mono">{t.trackAPoints ?? 0} / 30</td>
                      <td className="mono">{t.trackBPoints ?? 0} / 30</td>
                      <td className="mono">{t.trackCPoints ?? 0} / 40</td>
                      <td className="mono" style={{ fontWeight: 800, color: "var(--accent)" }}>
                        {t.totalPoints ?? 0} / 100
                      </td>
                      <td className="mono" style={{ fontSize: "0.85rem" }}>
                        {t.reachedAt ? new Date(t.reachedAt).toLocaleTimeString() : "—"}
                      </td>
                      <td className="mono">{t.trackAAttempts ?? 0} / 3</td>
                      <td className="mono">{t.trackBAttempts ?? 0} / 3</td>
                      <td className="mono">{t.trackCAttempts ?? 0} / 3</td>
                      <td>
                        <span className={`pill stage${t.stageReached}`}>
                          {stageWord(t.stageReached)}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem", borderColor: "rgba(255,255,255,0.2)" }}
                          onClick={() => handleResetTeam(t)}
                        >
                          Reset
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. LEVEL 1 CHALLENGE CONFIGURATION */}
        {config && (
          <form onSubmit={handleSaveConfig} className="card" style={{ maxWidth: "none", marginBottom: "1.5rem" }}>
            <h2 className="stage-title" style={{ marginTop: 0, marginBottom: "0.4rem" }}>
              3. LEVEL 1 CHALLENGE CONFIGURATION
            </h2>
            <p className="stage-copy" style={{ margin: "0 0 1.5rem", fontSize: "0.88rem", color: "var(--muted)" }}>
              Configure the server-side values used by Level 1 challenges. These settings are visible only to Level 1 administrators and are never shown to participants.
            </p>

            <ConfigField
              track="TRACK A"
              label="SOC CASE REFERENCE"
              value={config.stage1_code}
              onChange={(v) => setConfig({ ...config, stage1_code: v })}
            />
            <ConfigField
              track="TRACK B"
              label="SECRET WORD"
              value={config.stage2_secret_word}
              onChange={(v) => setConfig({ ...config, stage2_secret_word: v })}
            />
            <ConfigField
              track="TRACK B"
              label="SANCTUARY ADDRESS / ROUND 2 COORDINATE"
              value={config.round2_address}
              onChange={(v) => setConfig({ ...config, round2_address: v })}
            />

            <div style={{ marginTop: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
              <button className="btn secondary" type="submit" style={{ fontWeight: 700, padding: "0.6rem 1.4rem" }}>
                SAVE CONFIGURATION
              </button>
              {savedMsg && <span className="success-text">{savedMsg}</span>}
            </div>
          </form>
        )}

        {/* 4. DANGER ZONE */}
        <div className="card" style={{ maxWidth: "none", borderColor: "rgba(255, 59, 59, 0.4)" }}>
          <h2 className="stage-title" style={{ marginTop: 0, color: "var(--critical)" }}>4. DANGER ZONE</h2>
          <p className="stage-copy" style={{ fontWeight: 600, color: "var(--ink)", marginBottom: "0.5rem" }}>
            Reset all Level 1 event progress.
          </p>
          <p className="stage-copy" style={{ fontSize: "0.88rem", color: "var(--muted)", margin: "0 0 1rem" }}>
            Wipes EVERY team&apos;s progress (all answers, attempts, checkpoints) back to 0 points,
            and resets the event clock to <strong>NOT STARTED</strong>. Team names, codes, and credentials are preserved.
            Only use this between dry runs or before the official event starts.
          </p>
          <div className="field-row">
            <input
              type="text"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
            />
            <button
              type="button"
              className="btn"
              style={{ background: "var(--critical)" }}
              disabled={resetConfirmText !== "RESET" || resetBusy}
              onClick={handleResetEvent}
            >
              {resetBusy ? "Resetting..." : "Reset All Teams & Clock"}
            </button>
          </div>
          {resetMsg && <p className={resetMsg.startsWith("Done") ? "success-text" : "error-text"}>{resetMsg}</p>}
        </div>
      </div>
    </div>
  );
}

function stageWord(n) {
  return { 0: "Track A", 1: "Track B", 2: "Track C", 3: "Completed" }[n] || "-";
}

function StatTile({ label, value }) {
  return (
    <div className="stat-tile">
      <div className="num mono">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function ConfigField({ track, label, value, onChange }) {
  return (
    <div style={{ marginBottom: "1.2rem" }}>
      <div style={{ fontSize: "0.75rem", letterSpacing: "0.08em", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", marginBottom: "0.25rem" }}>
        {track}
      </div>
      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)", marginBottom: "0.4rem" }}>
        {label}
      </label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", maxWidth: "520px" }}
      />
    </div>
  );
}
