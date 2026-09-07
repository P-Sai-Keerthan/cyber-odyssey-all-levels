import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import OdysseusGuide from "../components/OdysseusGuide";
import EvidenceBoard from "../components/EvidenceBoard";
import { useCountdown } from "../lib/useCountdown";
import { MAP_STAGES, MAP_LABELS, MAP_NODE_POSITIONS, VoyageMapPath } from "../components/VoyageMap";
import { portalLevel1Url } from "../lib/portalLink";

const POLL_MS = 4000;

const MAP_TRANSITION_COPY = {
  trackB: "Scam Bazaar charted. Setting sail for the leaked session.",
  trackC: "Session Hijack charted. Setting sail for the evidence board.",
  stage2: "Evidence Board completed. The Cyclops's cave lies ahead.",
  final: "The cave is behind you. One knot left to tie.",
  complete: "Ithaca, sighted at last.",
};

// The reward popup used to rely on an in-memory ref to remember "what
// stage was this team on a moment ago" — which works fine while the page
// stays mounted, but is wiped the instant the page reloads or is left and
// come back to (a manual refresh, a dropped connection, closing the tab
// right after the last correct answer). If that reset happened to land
// between "answer accepted" and "next poll fires," the crew would land
// straight on the new track's questions having never seen the popup at
// all — a real gap, not just a cosmetic one, since clearing a track is the
// whole payoff moment.
//
// Stashing the last-celebrated stage in localStorage (keyed per team code,
// so switching vessels on the same device can't cross-contaminate one
// team's popup state into another's) survives exactly that reload. It's
// deliberately per-device, not synced through the server — this stays a
// lightweight "did *this* browser already show the fanfare" flag, not a
// shared team-wide record, which matches how the rest of this popup was
// always meant to work (a celebratory beat, not gameplay-critical state).
const CELEBRATED_STAGE_PREFIX = "cyber-odyssey:lastCelebratedStage:";

function readCelebratedStage(teamCode) {
  try {
    return window.localStorage.getItem(CELEBRATED_STAGE_PREFIX + teamCode);
  } catch {
    // Private browsing / storage disabled — caller falls back to
    // in-memory-only tracking for the rest of this page's lifetime.
    return null;
  }
}

function writeCelebratedStage(teamCode, stage) {
  try {
    window.localStorage.setItem(CELEBRATED_STAGE_PREFIX + teamCode, stage);
  } catch {
    // Best-effort only — see readCelebratedStage.
  }
}

export default function Play() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const [mapTransition, setMapTransition] = useState(null); // {from, to} | null
  const prevStageRef = useRef(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/team/state");
      if (res.status === 401) {
        setNotLoggedIn(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || data.error || "Unable to load challenge session.");
        return;
      }
      const data = await res.json();
      setState(data);
      setError(null);
      setTimedOut(false);
    } catch {
      // transient network hiccup — next poll will retry
    }
  }, []);

  useEffect(() => {
    fetchState();
    const timeout = setTimeout(() => {
      setTimedOut(true);
    }, 6000);
    const id = setInterval(fetchState, POLL_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(id);
    };
  }, [fetchState]);

  useEffect(() => {
    if (notLoggedIn) router.push("/");
  }, [notLoggedIn, router]);

  // Watch for a stage the team has actually just arrived at (not the
  // stage they load into on a fresh page visit — with nothing stored yet,
  // the very first read never triggers this) and, only when the move is a
  // forward step between two real topic stages, show the map interstitial
  // once before letting the new stage's content through.
  //
  // "Forward step" specifically (via MAP_STAGES index comparison) so an
  // admin's event reset — which snaps a team's true stage back to stage1
  // server-side while this browser's localStorage still remembers a later
  // stage from before the reset — resyncs quietly instead of firing a
  // backwards "congratulations" popup.
  useEffect(() => {
    const stage = state?.stage;
    const teamCode = state?.team?.code;
    if (!stage || !teamCode || !MAP_STAGES.includes(stage)) return;

    const prev = readCelebratedStage(teamCode) || prevStageRef.current;

    if (
      prev &&
      prev !== stage &&
      MAP_STAGES.includes(prev) &&
      MAP_STAGES.indexOf(stage) > MAP_STAGES.indexOf(prev)
    ) {
      setMapTransition({ from: prev, to: stage });
    }

    prevStageRef.current = stage;
  }, [state?.stage, state?.team?.code]);

  // A deliberate, explicit way to leave a run mid-event — for a team
  // testing with multiple codes on one device, or genuinely handing the
  // device to a different crew. (The Back button now has a real
  // destination of its own — /hub, pushed onto history before /play —
  // so this isn't fighting anything the way an earlier version's
  // Back-button trap did; it's just a faster, explicit exit.)
  async function switchTeam() {
    try {
      await fetch("/api/team/logout", { method: "POST" });
    } catch {
      // best-effort — even if this fails, router.push below still moves
      // the team off /play; a stale cookie just means the login form
      // will need a fresh code typed in rather than staying blocked.
    }
    router.push("/");
  }

  const isPaused = state?.event?.phase === "paused";
  const timer = useCountdown(state?.event?.endAt);
  const timeIsUp = state?.event?.phase === "ended";

  if (error || (!state && timedOut)) {
    return (
      <div className="shell">
        <Head>
          <title>Cyber Odyssey &mdash; Level 1 Voyage</title>
        </Head>
        <main className="center">
          <div className="card" style={{ maxWidth: 480, textAlign: "center", margin: "2rem auto" }}>
            <div className="stage-tag" style={{ color: "var(--critical, #f87171)" }}>
              Level 1 Session Notice
            </div>
            <h2 className="stage-title" style={{ fontSize: "1.3rem", margin: "0.6rem 0" }}>
              Unable to Enter Level 1
            </h2>
            <p className="stage-copy" style={{ marginBottom: "1.5rem" }}>
              {error || "Loading your squad challenge session timed out. Please retry or return to the participant portal."}
            </p>
            <div style={{ display: "flex", gap: "0.8rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setError(null);
                  setTimedOut(false);
                  fetchState();
                }}
              >
                Retry
              </button>
              <a
                className="btn secondary"
                href={portalLevel1Url()}
                style={{ textDecoration: "none" }}
              >
                Return to Portal
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="shell">
        <main className="center">
          <p className="stage-copy">Loading Level 1 voyage…</p>
        </main>
      </div>
    );
  }

  const teamDisplayName = state.team?.name
    ? `${state.team.name} · ${state.team.code}`
    : state.team?.code;

  return (
    <div className="shell">
      <Head>
        <title>Cyber Odyssey &mdash; Voyage</title>
      </Head>
      <div className="topbar">
        <span className="team-code">
          {teamDisplayName}
          <button type="button" className="switch-team-btn" onClick={() => router.push("/hub")}>
            voyage map
          </button>
          <button type="button" className="switch-team-btn" onClick={switchTeam}>
            switch team
          </button>
        </span>
        <span className="stage-tag">
          {timeIsUp ? "VOYAGE CLOSED" : isPaused ? "VOYAGE PAUSED" : stageLabel(state.stage)}
        </span>
        <span className="timer" data-level={isPaused ? "warn" : timer.level}>
          {state.event?.phase === "not_started" ? "--:--" : isPaused ? "PAUSED" : timer.text}
        </span>
      </div>

      {mapTransition && (
        <TrackMapTransition
          from={mapTransition.from}
          to={mapTransition.to}
          onDone={() => {
            if (state?.team?.code && mapTransition.to) {
              writeCelebratedStage(state.team.code, mapTransition.to);
            }
            setMapTransition(null);
            fetchState();
          }}
        />
      )}

      <div className="stage-wrap">
        <div className="card">
          {timeIsUp || state.stage === "complete" ? (
            <FinalResultView
              scoreSummary={state.finalScore || state.scoreSummary}
              completed={Boolean(state.trackC?.completed || state.stage === "complete")}
              finishedAt={state.finalScore?.finishedAt || state.complete?.finishedAt}
              timeIsUp={timeIsUp}
              address={state.complete?.address}
            />
          ) : isPaused ? (
            <PausedView />
          ) : state.stage === "waiting" ? (
            <WaitingView />
          ) : state.stage === "stage1" ? (
            <TrackAView data={state.stage1} onProgress={fetchState} />
          ) : state.stage === "trackB" ? (
            <TrackBView data={state.trackB} onProgress={fetchState} />
          ) : state.stage === "trackC" ? (
            <EvidenceBoard onComplete={fetchState} isCompleted={Boolean(state.trackC?.completed)} trackCState={state.trackC} />
          ) : state.stage === "stage2" ? (
            <Stage2View data={state.stage2} onProgress={fetchState} />
          ) : state.stage === "final" ? (
            <FinalView data={state.final} onProgress={fetchState} />
          ) : null}
        </div>
      </div>
      <OdysseusGuide stage={timeIsUp || state.stage === "complete" ? "complete" : isPaused ? "waiting" : state.stage} />
    </div>
  );
}

function stageLabel(stage) {
  switch (stage) {
    case "waiting": return "Awaiting the winds";
    case "stage1": return "Track A · SOC Email Threat Hunting";
    case "trackB": return "Track B · AppSec Session Security";
    case "trackC": return "Track C · DFIR Evidence Hub";
    case "stage2": return "Stage 2 · The Cyclops's Cave";
    case "final": return "Stage 3 · The Great Bow";
    case "complete": return "Ithaca Sighted";
    default: return "";
  }
}

// Shown once, full-screen, right when a team clears a whole topic — not
// between individual questions, and not boxed inside `.card` the way the
// first version was. The road itself (VoyageMapPath, shared with
// pages/hub.js) is handed `initialY` at the *previous* node's position,
// so it animates in only the newly-earned segment rather than replaying
// the whole route from the top every time.
function TrackMapTransition({ from, to, onDone }) {
  const [showChestModal, setShowChestModal] = useState(false);
  const fromIdx = Math.max(0, MAP_STAGES.indexOf(from));
  const toIdx = MAP_STAGES.indexOf(to);
  const initialY = MAP_NODE_POSITIONS[fromIdx]?.y ?? 100;
  const nextStageLabel = MAP_LABELS[to] || "Next Stage";

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowChestModal(true);
    }, 1400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="map-overlay">
      <div className="map-overlay-inner">
        <p className="map-transition-eyebrow">Course Charted &middot; Navigating to {nextStageLabel}</p>
        <h2 className="map-transition-title" style={{ fontSize: "1.2rem", color: "var(--accent)", margin: "0.4rem 0 1.2rem" }}>
          {MAP_TRANSITION_COPY[to] || "Onward."}
        </h2>

        <VoyageMapPath currentIndex={toIdx} initialY={initialY} onEnterCurrent={onDone} />
      </div>

      {showChestModal && (
        <div className="track-unlocked-overlay" onClick={onDone} role="button" tabIndex={0}>
          <div className="track-unlocked-modal" onClick={(e) => e.stopPropagation()}>
            <div className="unlocked-eyebrow mono">TRACK UNLOCKED</div>
            <h2 className="unlocked-title">{nextStageLabel} Unlocked!</h2>

            <div className="chest-graphic-wrap">
              <div className="chest-glow-radial" />
              <svg viewBox="0 0 160 160" width="160" height="160" className="chest-svg">
                <defs>
                  <radialGradient id="chestGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fff8db" stopOpacity="1" />
                    <stop offset="50%" stopColor="#ffd700" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="woodGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#b36b22" />
                    <stop offset="100%" stopColor="#6e3d0e" />
                  </linearGradient>
                  <linearGradient id="silverTrim" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#e2edf8" />
                    <stop offset="100%" stopColor="#8ca0b3" />
                  </linearGradient>
                </defs>

                {/* Light Rays & Sparkles */}
                <path d="M80 70 L30 10 L45 5 Z M80 70 L80 0 L90 0 Z M80 70 L130 10 L115 5 Z" fill="url(#chestGlow)" opacity="0.6" />
                <circle cx="80" cy="65" r="45" fill="url(#chestGlow)" />
                
                {/* Sparkle Stars */}
                <polygon points="80,20 83,28 91,31 83,34 80,42 77,34 69,31 77,28" fill="#ffffff" />
                <polygon points="55,40 57,45 62,47 57,49 55,54 53,49 48,47 53,45" fill="#fff5b8" />
                <polygon points="105,38 107,43 112,45 107,47 105,52 103,47 98,45 103,43" fill="#fff5b8" />

                {/* Chest Base */}
                <path d="M35 85 L125 85 L115 135 L45 135 Z" fill="url(#woodGrad)" stroke="#422205" strokeWidth="3" />
                <path d="M30 85 L45 135 M130 85 L115 135" stroke="url(#silverTrim)" strokeWidth="6" strokeLinecap="round" />

                {/* Chest Lid (Open) */}
                <path d="M30 85 C30 45 130 45 130 85 C115 70 45 70 30 85 Z" fill="url(#silverTrim)" stroke="#422205" strokeWidth="2" />
                <path d="M38 75 C45 52 115 52 122 75 Z" fill="url(#woodGrad)" />

                {/* Silver Keyhole Plate */}
                <rect x="70" y="95" width="20" height="25" rx="4" fill="url(#silverTrim)" stroke="#334155" strokeWidth="1.5" />
                <circle cx="80" cy="103" r="3.5" fill="#1e293b" />
                <polygon points="78,103 82,103 84,113 76,113" fill="#1e293b" />
              </svg>
            </div>

            <p className="unlocked-desc mono">
              {MAP_TRANSITION_COPY[to] || "Onward."}
            </p>

            <button type="button" className="unlocked-continue-btn" onClick={onDone}>
              Enter {nextStageLabel} &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WaitingView() {
  return (
    <div>
      <div className="stage-tag">Not open yet</div>
      <h2 className="stage-title">The fleet waits at anchor</h2>
      <p className="stage-copy">
        You're logged in and ready. This page updates itself the instant the
        organizers release the fleet — no need to refresh.
      </p>
    </div>
  );
}

function PausedView() {
  return (
    <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
      <div className="stage-tag" style={{ color: "var(--accent)" }}>VOYAGE PAUSED</div>
      <h2 className="stage-title">The Sands of Time Stand Still</h2>
      <p className="stage-copy" style={{ maxWidth: 500, margin: "0 auto 1.2rem" }}>
        The Oracle has paused the sands of time. Submissions and timer countdowns are temporarily held. Stand by for the fleet command to resume the voyage.
      </p>
      <div className="mono" style={{ fontSize: "1rem", color: "var(--accent)", padding: "0.8rem 1.2rem", border: "1px dashed rgba(255, 215, 0, 0.4)", borderRadius: "8px", display: "inline-block" }}>
        Stand by &bull; Resumption pending
      </div>
    </div>
  );
}

function FinalResultView({ scoreSummary, completed, finishedAt, timeIsUp, address }) {
  const total = scoreSummary?.total ?? (scoreSummary?.totalPoints ?? 0);
  const trackA = scoreSummary?.trackA ?? 0;
  const trackB = scoreSummary?.trackB ?? 0;
  const trackC = scoreSummary?.trackC ?? 0;

  let completionTimeText = "Time Expired";
  if (finishedAt) {
    try {
      completionTimeText = new Date(finishedAt).toLocaleTimeString();
    } catch {
      completionTimeText = String(finishedAt);
    }
  }

  return (
    <div style={{ textAlign: "center", padding: "1.5rem 0.5rem" }}>
      <div className="stage-tag" style={{ color: completed ? "var(--good)" : "var(--accent)" }}>
        {completed ? "LEVEL 1 COMPLETE" : "VOYAGE CONCLUDED"}
      </div>
      <h2 className="stage-title" style={{ fontSize: "1.8rem", margin: "0.5rem 0 1.2rem" }}>
        {completed ? "Your Journey Ends Here" : "The Winds Have Died"}
      </h2>

      <div style={{
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 215, 0, 0.3)",
        borderRadius: "12px",
        padding: "1.5rem",
        maxWidth: "460px",
        margin: "0 auto 1.5rem",
      }}>
        <div style={{ fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px" }}>
          Your Final Score
        </div>
        <div className="mono" style={{ fontSize: "3rem", fontWeight: 800, color: "var(--accent)", margin: "0.3rem 0 1rem" }}>
          {total} <span style={{ fontSize: "1.2rem", fontWeight: 400, color: "var(--muted)" }}>/ 100 pts</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", borderTop: "1px solid rgba(255, 255, 255, 0.1)", paddingTop: "1rem", marginBottom: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Track A</div>
            <div className="mono" style={{ fontSize: "1.1rem", fontWeight: 700 }}>{trackA} / 30</div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Track B</div>
            <div className="mono" style={{ fontSize: "1.1rem", fontWeight: 700 }}>{trackB} / 30</div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Track C</div>
            <div className="mono" style={{ fontSize: "1.1rem", fontWeight: 700 }}>{trackC} / 40</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-around", borderTop: "1px solid rgba(255, 255, 255, 0.1)", paddingTop: "0.8rem", fontSize: "0.85rem" }}>
          <div>
            <span style={{ color: "var(--muted)" }}>Status: </span>
            <span style={{ fontWeight: 600, color: completed ? "var(--good)" : "var(--accent)" }}>
              {completed ? "Completed" : "Incomplete"}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--muted)" }}>Completion Time: </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {completed ? completionTimeText : "Time Expired"}
            </span>
          </div>
        </div>
      </div>

      {address && completed && (
        <div style={{ marginBottom: "1.5rem" }}>
          <p className="stage-copy" style={{ margin: "0 0 0.3rem", fontSize: "0.9rem" }}>Ithaca Sanctuary Coordinate:</p>
          <p className="mono" style={{ fontSize: "1.2rem", color: "var(--good)", margin: 0 }}>{address}</p>
        </div>
      )}

      <p className="stage-copy" style={{ maxWidth: 440, margin: "0 auto", fontSize: "0.95rem", opacity: 0.9 }}>
        Your score has been submitted to the Grand Council of Ithaca.
        Wait for the organizers to announce the advancing teams.
      </p>
    </div>
  );
}

function TimeUpView() {
  return (
    <div>
      <div className="stage-tag" style={{ color: "var(--critical)" }}>Time&apos;s up</div>
      <h2 className="stage-title">The winds have died</h2>
      <p className="stage-copy">
        Submissions are locked. Check with an organizer for standings and
        whether your crew sails on.
      </p>
    </div>
  );
}

// Which question a team lands on when a track first loads or reloads:
// the first one that's neither solved nor locked, or the first question
// if everything is already resolved. Computed once per mount via
// useState's lazy initializer — a background poll updating `questions`
// should never yank the page out from under someone mid-read.
function firstOpenIndex(questions) {
  const i = questions.findIndex((q) => !q.correct && !q.locked);
  return i === -1 ? 0 : i;
}

// The "1 / 2 / 3" strip with a bouncing pin over wherever the team
// currently is. Since Track A and B both use the simultaneous,
// independently-capped attempt model (no sequential gating between
// questions in one track), every node is always clickable — this is a
// display convenience for "one question per page," not a lock.
function QuestionNav({ questions, activeIndex, onSelect }) {
  return (
    <div className="qnav">
      <div className="qnav-line" />
      {questions.map((q, i) => {
        const status = q.correct ? "done" : q.locked ? "locked" : "open";
        return (
          <button
            key={q.code}
            type="button"
            className={`qnav-node qnav-${status}${i === activeIndex ? " qnav-current" : ""}`}
            onClick={() => onSelect(i)}
            aria-label={`Question ${i + 1}: ${q.title}${q.correct ? " (solved)" : q.locked ? " (locked)" : ""}`}
            aria-current={i === activeIndex ? "true" : undefined}
          >
            {i === activeIndex && <span className="qnav-pin" aria-hidden="true">📍</span>}
            <span className="qnav-num">
              {q.correct ? "✓" : q.locked ? "✕" : i + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionPager({ activeIndex, count, onPrev, onNext }) {
  return (
    <div className="qpager">
      <button className="btn secondary" type="button" disabled={activeIndex === 0} onClick={onPrev}>
        ← Previous
      </button>
      <span className="stage-copy" style={{ margin: 0 }}>
        Question {activeIndex + 1} of {count}
      </span>
      <button className="btn secondary" type="button" disabled={activeIndex === count - 1} onClick={onNext}>
        Next →
      </button>
    </div>
  );
}

function TrackAView({ data, onProgress }) {
  const [activeIndex, setActiveIndex] = useState(() => firstOpenIndex(data.questions));
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, data.questions.length - 1));
  }, [data.questions.length]);

  const q = data.questions[activeIndex];

  return (
    <div>
      <div className="stage-tag">Track A · SOC Email Threat Hunting (30 pts)</div>
      <h2 className="stage-title">The Accidental Reply-All</h2>
      <p className="stage-copy">
        Ithaca Holdings' entire staff list just received an email that
        looks like HR fat-fingered a reply-all: a restructuring
        spreadsheet attached, a panicked "please ignore, wasn't meant for
        everyone," and a link to "review your severance details." Before
        anyone reacts, your crew's job is to prove where this actually
        came from.
      </p>

      <div className="field-row" style={{ marginBottom: "1.2rem" }}>
        <a
          className="btn secondary"
          href={data.evidenceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the raw header block
        </a>
        <span className="stage-copy" style={{ margin: 0 }}>
          {data.pointsEarned} / {data.totalPoints} pts
        </span>
      </div>

      <QuestionNav questions={data.questions} activeIndex={activeIndex} onSelect={setActiveIndex} />

      <TrackAQuestion key={q.code} question={q} onProgress={onProgress} />

      <QuestionPager
        activeIndex={activeIndex}
        count={data.questions.length}
        onPrev={() => setActiveIndex((i) => Math.max(0, i - 1))}
        onNext={() => setActiveIndex((i) => Math.min(data.questions.length - 1, i + 1))}
      />
    </div>
  );
}

function TrackAQuestion({ question, onProgress }) {
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Local mirror of the server's per-question state so a locked/solved
  // result shows up the instant this device submits, not just after the
  // next 4-second poll — but it still re-syncs from `question` whenever
  // the poll brings back a change (e.g. a teammate solved or exhausted
  // this same question from their own phone).
  const [local, setLocal] = useState({
    correct: question.correct,
    attempts: question.attempts,
    locked: question.locked,
  });
  useEffect(() => {
    setLocal({ correct: question.correct, attempts: question.attempts, locked: question.locked });
  }, [question.correct, question.attempts, question.locked]);

  const solved = local.correct;
  const locked = local.locked;
  const disabled = solved || locked;
  const attemptsLeft = Math.max(0, question.maxAttempts - local.attempts);

  async function submit(e) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/trackA/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionCode: question.code, answer, evidence }),
    });
    const out = await res.json();
    setBusy(false);
    if (out.error) {
      setMsg({ ok: false, text: eventErrorText(out.error) });
      return;
    }
    setMsg({ ok: out.correct, text: out.message });
    setLocal({ correct: out.correct, attempts: out.attempts, locked: out.locked });
    setTimeout(onProgress, out.correct ? 400 : 0);
  }

  return (
    <form
      onSubmit={submit}
      className="card"
      style={{ maxWidth: "none", marginBottom: "1.2rem", opacity: disabled ? 0.75 : 1 }}
    >
      <div className="field-row" style={{ marginBottom: "0.4rem" }}>
        <h3 className="stage-title" style={{ fontSize: "1.1rem", margin: 0 }}>
          {question.title}
        </h3>
        <span className="mono">
          {solved ? "✓ " : locked ? "✕ " : ""}
          {question.points} pts
        </span>
      </div>
      <p className="stage-copy">{question.prompt}</p>

      {!disabled && (
        <p className="stage-copy" style={{ margin: "0 0 0.6rem", opacity: 0.8 }}>
          {attemptsLeft} of {question.maxAttempts} attempts left for your whole crew — this is
          shared across every device logged in with your team credentials.
        </p>
      )}
      {locked && (
        <p className="error-text" style={{ margin: "0 0 0.6rem" }}>
          Locked — your crew used all {question.maxAttempts} attempts on this one. It stays at 0
          points; move on to the others.
        </p>
      )}

      <label htmlFor={`answer-${question.code}`}>{question.title}</label>
      <div className="field-row">
        <input
          id={`answer-${question.code}`}
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={question.placeholder}
          disabled={disabled}
        />
        <button className="btn" disabled={busy || disabled || !answer.trim()}>
          {solved ? "Solved" : locked ? "Locked" : busy ? "Checking..." : "Submit"}
        </button>
      </div>

      {msg && <p className={msg.ok ? "success-text" : "error-text"}>{msg.text}</p>}
    </form>
  );
}

function TrackBView({ data, onProgress }) {
  const [activeIndex, setActiveIndex] = useState(() => firstOpenIndex(data.questions));
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, data.questions.length - 1));
  }, [data.questions.length]);

  const q = data.questions[activeIndex];

  return (
    <div>
      <div className="stage-tag">Track B · AppSec Session Security (30 pts)</div>
      <h2 className="stage-title">One Leaked Token</h2>
      <p className="stage-copy">
        The credential from the reply-all incident got used minutes later — a
        login to Ithaca Holdings' internal wiki, session captured on the
        network. It's just three dot-separated blocks of text. Decode it.
      </p>

      <div className="field-row" style={{ marginBottom: "1.2rem" }}>
        <a
          className="btn secondary"
          href={data.evidenceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the captured token
        </a>
        <span className="stage-copy" style={{ margin: 0 }}>
          {data.pointsEarned} / {data.totalPoints} pts
        </span>
      </div>

      <QuestionNav questions={data.questions} activeIndex={activeIndex} onSelect={setActiveIndex} />

      <TrackBQuestion key={q.code} question={q} onProgress={onProgress} />

      <QuestionPager
        activeIndex={activeIndex}
        count={data.questions.length}
        onPrev={() => setActiveIndex((i) => Math.max(0, i - 1))}
        onNext={() => setActiveIndex((i) => Math.min(data.questions.length - 1, i + 1))}
      />
    </div>
  );
}

function TrackBQuestion({ question, onProgress }) {
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hintText, setHintText] = useState(null);
  const [hintBusy, setHintBusy] = useState(false);

  const [local, setLocal] = useState({
    correct: question.correct,
    attempts: question.attempts,
    locked: question.locked,
    hintUsed: question.hintUsed,
  });
  useEffect(() => {
    setLocal({
      correct: question.correct,
      attempts: question.attempts,
      locked: question.locked,
      hintUsed: question.hintUsed,
    });
  }, [question.correct, question.attempts, question.locked, question.hintUsed]);

  const solved = local.correct;
  const locked = local.locked;
  const disabled = solved || locked;
  const attemptsLeft = Math.max(0, question.maxAttempts - local.attempts);
  const effectivePoints = local.hintUsed ? Math.max(0, question.points - 2) : question.points;

  async function revealHint() {
    if (hintText || hintBusy) return;
    setHintBusy(true);
    const res = await fetch("/api/trackB/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionCode: question.code }),
    });
    const out = await res.json();
    setHintBusy(false);
    if (out.error) return;
    setHintText(out.hint);
    if (!out.alreadySolved) setLocal((l) => ({ ...l, hintUsed: true }));
  }

  async function submit(e) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/trackB/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionCode: question.code, answer, evidence }),
    });
    const out = await res.json();
    setBusy(false);
    if (out.error) {
      setMsg({ ok: false, text: eventErrorText(out.error) });
      return;
    }
    setMsg({ ok: out.correct, text: out.message });
    setLocal({ correct: out.correct, attempts: out.attempts, locked: out.locked, hintUsed: out.hintUsed });
    setTimeout(onProgress, out.correct ? 400 : 0);
  }

  return (
    <form
      onSubmit={submit}
      className="card"
      style={{ maxWidth: "none", marginBottom: "1.2rem", opacity: disabled ? 0.75 : 1 }}
    >
      <div className="field-row" style={{ marginBottom: "0.4rem" }}>
        <h3 className="stage-title" style={{ fontSize: "1.1rem", margin: 0 }}>
          {question.title}
        </h3>
        <span className="mono">
          {solved ? "✓ " : locked ? "✕ " : ""}
          {effectivePoints} pts
          {local.hintUsed && !solved ? " (hint used)" : ""}
        </span>
      </div>
      <p className="stage-copy">{question.prompt}</p>

      {!disabled && (
        <p className="stage-copy" style={{ margin: "0 0 0.6rem", opacity: 0.8 }}>
          {attemptsLeft} of {question.maxAttempts} attempts left for your whole crew.
        </p>
      )}
      {locked && (
        <p className="error-text" style={{ margin: "0 0 0.6rem" }}>
          Locked — your crew used all {question.maxAttempts} attempts on this one. It stays at 0
          points; move on to the others.
        </p>
      )}

      {!disabled && (
        <div style={{ marginBottom: "0.6rem" }}>
          {hintText ? (
            <p className="stage-copy" style={{ margin: 0, opacity: 0.85 }}>💡 {hintText}</p>
          ) : (
            <button
              type="button"
              className="btn secondary"
              onClick={revealHint}
              disabled={hintBusy}
              style={{ fontSize: "0.85rem" }}
            >
              {hintBusy ? "..." : "Reveal Hint (-2 pts)"}
            </button>
          )}
        </div>
      )}

      <label htmlFor={`answer-${question.code}`}>{question.title}</label>
      <div className="field-row">
        <input
          id={`answer-${question.code}`}
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={question.placeholder}
          disabled={disabled}
        />
        <button className="btn" disabled={busy || disabled || !answer.trim()}>
          {solved ? "Solved" : locked ? "Locked" : busy ? "Checking..." : "Submit"}
        </button>
      </div>

      {msg && <p className={msg.ok ? "success-text" : "error-text"}>{msg.text}</p>}
    </form>
  );
}

function Stage2View({ data, onProgress }) {
  const [history, setHistory] = useState(data.history || []);
  const seeded = useRef(false);
  const [message, setMessage] = useState("");
  const [word, setWord] = useState("");
  const [sending, setSending] = useState(false);
  const [wordMsg, setWordMsg] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (!seeded.current) {
      setHistory(data.history || []);
      seeded.current = true;
    }
  }, [data.history]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [history]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    const outgoing = message.trim();
    setMessage("");
    setHistory((h) => [...h, { role: "team", content: outgoing }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: outgoing }),
    });
    const out = await res.json();
    setSending(false);
    if (out.error) {
      setHistory((h) => [...h, { role: "cyclops", content: eventErrorText(out.error) }]);
      return;
    }
    setHistory((h) => [...h, { role: "cyclops", content: out.reply }]);
  }

  async function submitWord(e) {
    e.preventDefault();
    const res = await fetch("/api/stage2/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
    });
    const out = await res.json();
    if (out.error) {
      setWordMsg({ ok: false, text: eventErrorText(out.error) });
      return;
    }
    setWordMsg({ ok: out.correct, text: out.message });
    if (out.correct) setTimeout(onProgress, 500);
  }

  return (
    <div>
      <div className="stage-tag">Stage 2</div>
      <h2 className="stage-title">The Cyclops's Cave</h2>
      <p className="stage-copy">
        Polyphemus blocks the only way out, and he won't say the word that
        moves the boulder — not to a stranger, anyway. Odysseus talked his
        way past this exact Cyclops once. Whatever it takes.
      </p>

      <div className="chat-log" ref={logRef}>
        {history.length === 0 && (
          <p className="stage-copy" style={{ margin: 0 }}>Say something to start.</p>
        )}
        {history.map((m, i) => (
          <div key={i} className={`bubble ${m.role === "team" ? "team" : "cyclops"}`}>
            {m.content}
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="field-row" style={{ marginBottom: "1.4rem" }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Try something..."
        />
        <button className="btn" disabled={sending || !message.trim()}>Send</button>
      </form>

      <form onSubmit={submitWord}>
        <label htmlFor="s2word">The Word He Let Slip</label>
        <div className="field-row">
          <input
            id="s2word"
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="Enter the leaked word"
          />
          <button className="btn secondary" disabled={!word.trim()}>Submit</button>
        </div>
        {wordMsg && <p className={wordMsg.ok ? "success-text" : "error-text"}>{wordMsg.text}</p>}
      </form>
    </div>
  );
}

function FinalView({ data, onProgress }) {
  const [answer, setAnswer] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/final/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    const out = await res.json();
    setBusy(false);
    if (out.error) {
      setMsg({ ok: false, text: eventErrorText(out.error) });
      return;
    }
    if (out.correct) {
      setTimeout(onProgress, 400);
      return;
    }
    setMsg({ ok: false, text: out.message });
  }

  return (
    <div>
      <div className="stage-tag">Stage 3</div>
      <h2 className="stage-title">The Great Bow</h2>
      <p className="stage-copy">{data.rule}</p>

      <form onSubmit={submit}>
        <label htmlFor="finalanswer">The Strung Bow</label>
        <div className="field-row">
          <input
            id="finalanswer"
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value.toUpperCase())}
            placeholder="SHIFTED WORD"
          />
          <button className="btn" disabled={busy || !answer.trim()}>
            {busy ? "Drawing..." : "Loose the Arrow"}
          </button>
        </div>
        {msg && <p className="error-text">{msg.text}</p>}
      </form>
    </div>
  );
}

function CompleteView({ data }) {
  return (
    <div>
      <div className="stage-tag" style={{ color: "var(--good)" }}>Ithaca Sighted</div>
      <h2 className="stage-title">The bow sings true</h2>
      <p className="stage-copy">Ithaca lies at:</p>
      <p className="mono" style={{ fontSize: "1.3rem", color: "var(--good)" }}>
        {data.address}
      </p>
    </div>
  );
}

function eventErrorText(code) {
  switch (code) {
    case "not_started": return "The winds haven't risen yet.";
    case "event_ended": return "The winds have died — submissions are closed.";
    case "stage1_not_done": return "Survive Stage 1 first.";
    case "stage2_not_done": return "Survive Stage 2 first.";
    default: return "Something went wrong. Try again.";
  }
}
