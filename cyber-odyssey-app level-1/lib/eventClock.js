const { getAllConfig, setConfig } = require("./config");

// The whole event runs on ONE synchronized server clock, not per-team timers.
// 4 authoritative states:
//   - "not_started"
//   - "running" (OPEN)
//   - "paused" (timer frozen, submissions rejected with event_paused)
//   - "ended" (timer at 0, submissions rejected with event_ended)
async function getEventStatus() {
  const cfg = await getAllConfig();
  const durationMinutes = Math.max(1, Number(cfg.event_duration_minutes || "45"));
  const durationMs = durationMinutes * 60 * 1000;
  const state = cfg.event_state || (cfg.event_start_at ? "running" : "not_started");

  if (state === "not_started" || !cfg.event_start_at) {
    return {
      phase: "not_started",
      startAt: null,
      endAt: null,
      msRemaining: durationMs,
      durationMinutes,
    };
  }

  const startAt = new Date(cfg.event_start_at);
  const pausedMs = Math.max(0, Number(cfg.event_paused_ms || "0"));

  if (state === "paused") {
    const pausedAt = cfg.event_paused_at ? new Date(cfg.event_paused_at).getTime() : Date.now();
    const elapsedBeforePause = Math.max(0, pausedAt - startAt.getTime() - pausedMs);
    const msRemaining = Math.max(0, durationMs - elapsedBeforePause);
    const endAt = new Date(startAt.getTime() + durationMs + pausedMs);
    return {
      phase: "paused",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      msRemaining,
      durationMinutes,
      pausedAt: cfg.event_paused_at || null,
    };
  }

  if (state === "ended") {
    const endAt = new Date(startAt.getTime() + durationMs + pausedMs);
    return {
      phase: "ended",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      msRemaining: 0,
      durationMinutes,
    };
  }

  // "running" state
  const now = Date.now();
  const elapsed = Math.max(0, now - startAt.getTime() - pausedMs);
  const msRemaining = durationMs - elapsed;
  const endAt = new Date(startAt.getTime() + durationMs + pausedMs);

  if (msRemaining <= 0) {
    return {
      phase: "ended",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      msRemaining: 0,
      durationMinutes,
    };
  }

  return {
    phase: "running",
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    msRemaining,
    durationMinutes,
  };
}

async function transitionEventState(action) {
  const cfg = await getAllConfig();
  const currentState = cfg.event_state || (cfg.event_start_at ? "running" : "not_started");
  const now = new Date();

  if (action === "open" || action === "start") {
    if (currentState === "paused") {
      return await transitionEventState("resume");
    }
    const startIso = now.toISOString();
    await setConfig("event_start_at", startIso);
    await setConfig("event_state", "running");
    await setConfig("event_paused_at", "");
    await setConfig("event_paused_ms", "0");
    return { ok: true, state: "running", startAt: startIso };
  }

  if (action === "pause") {
    const pausedIso = now.toISOString();
    await setConfig("event_state", "paused");
    await setConfig("event_paused_at", pausedIso);
    return { ok: true, state: "paused", pausedAt: pausedIso };
  }

  if (action === "resume") {
    if (currentState === "paused" && cfg.event_paused_at) {
      const pausedAt = new Date(cfg.event_paused_at).getTime();
      const added = Math.max(0, now.getTime() - pausedAt);
      const totalPaused = Math.max(0, Number(cfg.event_paused_ms || "0")) + added;
      await setConfig("event_paused_ms", String(totalPaused));
    }
    await setConfig("event_state", "running");
    await setConfig("event_paused_at", "");
    return { ok: true, state: "running" };
  }

  if (action === "end") {
    await setConfig("event_state", "ended");
    return { ok: true, state: "ended" };
  }

  if (action === "reset") {
    await setConfig("event_start_at", "");
    await setConfig("event_state", "not_started");
    await setConfig("event_paused_at", "");
    await setConfig("event_paused_ms", "0");
    return { ok: true, state: "not_started" };
  }

  throw new Error(`Unknown event state action: ${action}`);
}

module.exports = { getEventStatus, transitionEventState };

