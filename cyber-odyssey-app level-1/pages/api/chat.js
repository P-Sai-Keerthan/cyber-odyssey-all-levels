const { recordStage2Attempt } = require("../../lib/teams");
const { getAuthenticatedTeam } = require("../../lib/requireTeam");
const { getConfig } = require("../../lib/config");
const { getEventStatus } = require("../../lib/eventClock");
const { addChatLog, getRecentChatTimestamps } = require("../../lib/chatLogs");
const { respond } = require("../../lib/gatekeeper");

const MIN_GAP_MS = 2500; // slow-down window between messages, per team
const MAX_ATTEMPTS = 60; // hard cap so one stuck team can't run the log table up forever

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // PLATFORM AUTH — not part of the challenge.
  //
  // This route previously read `req.cookies.sb_team` and passed it straight to
  // getTeamByCode, skipping the HMAC check in lib/cookies.js entirely. That had
  // two effects: a legitimately signed cookie ("CODE.hmac") never matched a team
  // code, so the route 401'd for every real user; and setting the cookie to a
  // BARE, UNSIGNED team code did match, so anyone who knew a code could drive
  // this endpoint as that team.
  //
  // getAuthenticatedTeam verifies the signature before resolving the team, the
  // same as every trackA/trackB/trackC route already did. The Cyclops gatekeeper
  // itself (lib/gatekeeper.js) is untouched — it is an INTENTIONAL
  // prompt-injection challenge and remains exactly as jailbreakable as designed.
  // What changed is who is allowed to talk to it, not how it behaves.
  const team = await getAuthenticatedTeam(req);
  if (!team) return res.status(401).json({ error: "not_logged_in" });
  const code = team.code;

  const event = await getEventStatus();
  if (event.phase !== "running") {
    return res.status(403).json({ error: event.phase === "not_started" ? "not_started" : "event_ended" });
  }

  if (team.stage1CompletedAt === null) {
    return res.status(403).json({ error: "stage1_not_done" });
  }
  if (team.stage2CompletedAt) {
    return res.status(200).json({ reply: "The Cyclops already told you what you needed. Move on.", leaked: false });
  }

  const message = String(req.body?.message || "").trim().slice(0, 300);
  if (!message) return res.status(400).json({ error: "Say something to the Cyclops first." });

  if (team.stage2Attempts >= MAX_ATTEMPTS) {
    return res.status(200).json({
      reply: "The Cyclops has stopped listening entirely. Ask an organizer for help.",
      leaked: false,
      capped: true,
    });
  }

  const recent = await getRecentChatTimestamps(team.id, MIN_GAP_MS);
  if (recent.length > 0) {
    return res.status(429).json({ reply: "Give the Cyclops a second to think.", leaked: false, rateLimited: true });
  }

  const secretWord = await getConfig("stage2_secret_word");
  const { reply, leaked, matchedPattern } = respond(message, {
    secretWord,
    attemptCount: team.stage2Attempts,
  });

  await addChatLog(team.id, "team", message, matchedPattern);
  await addChatLog(team.id, "cyclops", reply, matchedPattern);
  await recordStage2Attempt(code, leaked);

  res.status(200).json({ reply, leaked });
};
