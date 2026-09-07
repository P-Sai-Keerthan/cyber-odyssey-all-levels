import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import OdysseusGuide from "../components/OdysseusGuide";
import { MAP_STAGES, MAP_LABELS, VoyageMapPath } from "../components/VoyageMap";
import { portalLevel1Url } from "../lib/portalLink";

// The landing page a team sees right after logging in — and, just as
// important, wherever a Back tap from /play now lands them, since this
// page is a real route pushed onto browser history before /play (see
// the "Continue Voyage" handler below and pages/index.js). That's the
// actual fix for "Back kicks me out to the login form": Back now has a
// real, meaningful page to land on instead of nothing to land on at all.
//
// It does not offer a menu of tracks to jump between — Level 1's tracks
// are strictly sequential (Track A must resolve before Track B unlocks,
// and so on), so there is only ever exactly one "unlocked and not yet
// finished" track at a time. What this page gives instead is honest
// status: the same road the completion animation draws, at rest, plus
// one button that always means "go to wherever I currently am."
export default function Hub() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/team/state");
      if (res.status === 401) {
        setNotLoggedIn(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || data.error || "Unable to enter Level 1. Please try again.");
        return;
      }
      const data = await res.json();
      setState(data);
      setError(null);
      setTimedOut(false);
    } catch {
      setError("Unable to reach Level 1 server. Please check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    fetchState();
    const timeout = setTimeout(() => {
      setTimedOut(true);
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchState();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchState]);

  useEffect(() => {
    if (notLoggedIn) router.push("/");
  }, [notLoggedIn, router]);

  async function switchTeam() {
    try {
      await fetch("/api/team/logout", { method: "POST" });
    } catch {
      // best-effort — router.push below still moves the team off this
      // page even if the cookie somehow fails to clear
    }
    router.push("/");
  }

  if (error || (!state && timedOut)) {
    return (
      <div className="shell">
        <Head>
          <title>Cyber Odyssey &mdash; Level 1 Entry</title>
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
              {error || "Loading your squad session timed out. Please retry or return to the participant portal."}
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
          <p className="stage-copy">Opening Level 1 session…</p>
        </main>
      </div>
    );
  }

  const notStarted = state.event?.phase === "not_started";
  const isPaused = state.event?.phase === "paused";
  const timeIsUp = state.event?.phase === "ended";
  const onMap = MAP_STAGES.includes(state.stage);
  const currentIndex = onMap ? MAP_STAGES.indexOf(state.stage) : -1;

  let eyebrow = "Your voyage so far";
  let title = onMap ? `Currently charting: ${MAP_LABELS[state.stage]}` : "Ithaca lies ahead.";
  let ctaLabel = "Continue Voyage";
  if (notStarted) {
    eyebrow = "Not open yet";
    title = "The fleet waits at anchor.";
    ctaLabel = "Enter the Voyage";
  } else if (isPaused) {
    eyebrow = "Voyage paused";
    title = "The sands of time stand still.";
    ctaLabel = "Awaiting Resumption";
  } else if (timeIsUp) {
    eyebrow = "Voyage closed";
    title = "The winds have died.";
    ctaLabel = "View Final Result";
  } else if (state.stage === "complete") {
    eyebrow = "Journey's end";
    title = "Ithaca, sighted at last.";
    ctaLabel = "View Ithaca & Final Score";
  }

  const teamDisplayName = state.team?.name
    ? `${state.team.name} · ${state.team.code}`
    : state.team?.code;

  return (
    <div className="shell">
      <Head>
        <title>Cyber Odyssey &mdash; Voyage Map</title>
      </Head>
      <div className="topbar">
        <span className="team-code">
          {teamDisplayName}
          <button type="button" className="switch-team-btn" onClick={switchTeam}>
            switch team
          </button>
        </span>
        <span className="stage-tag">Voyage Map</span>
        <span />
      </div>

      <div className="hub-page">
        <div className="hub-inner">
          <p className="map-transition-eyebrow">{eyebrow}</p>
          <h2 className="map-transition-title">{title}</h2>

          <VoyageMapPath
            currentIndex={currentIndex}
            onEnterCurrent={!notStarted && !timeIsUp ? () => router.push("/play") : undefined}
          />

          <div className="hub-actions">
            <button className="btn" type="button" onClick={() => router.push("/play")}>
              {ctaLabel}
            </button>
          </div>
        </div>
      </div>

      <OdysseusGuide stage={state.stage === "complete" ? "complete" : notStarted ? "waiting" : "hub"} />
    </div>
  );
}
