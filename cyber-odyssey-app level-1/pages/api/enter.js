const crypto = require("crypto");
const { redeemTicket } = require("../../lib/portalClient");
const { upsertTeamForPortalRef } = require("../../lib/teams");
const { setCookie, signTeamCookie } = require("../../lib/cookies");
const { integrationSecret } = require("../../lib/integrationSignature");
const { portalBaseUrl } = require("../../lib/portalClient");

/**
 * Cyber Odyssey Portal -> Level 1 entry.
 *
 * A participant already signed in to the Portal clicks "Enter Level 1" and the
 * browser lands here carrying a one-time ticket. This route exchanges that ticket
 * for the squad's identity — server to server, over an HMAC-signed request the
 * browser cannot compose — and then issues Level 1's own session.
 *
 * ===========================================================================
 * WHAT THE BROWSER SUPPLIES, AND WHY IT DOES NOT MATTER
 * ===========================================================================
 * The browser supplies exactly one thing: an opaque 64-hex ticket. It carries no
 * team name, no team id, no squad reference and no score. Everything about WHO
 * this is comes back from the Portal in the redemption response.
 *
 * So there is no value here a participant can edit to become another squad. A
 * forged ticket fails the Portal's lookup; a real ticket belonging to somebody
 * else is single-use and already spent; a modified query string is just a ticket
 * that does not exist.
 *
 * ===========================================================================
 * WHY THIS IS A REDIRECT AND NOT A PAGE
 * ===========================================================================
 * The ticket must leave the address bar. Rendering a page at this URL would leave
 * it in the browser history, in the Referer of every subsequent request, and on
 * screen. A 302 to /hub means the ticket exists in the URL for exactly one
 * request, and the entry in history is the redirect target, not the ticket.
 */

/** A short, safe redirect that also clears any half-set state. */
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Never cache: the response sets a session cookie and depends on a one-time
  // value. A cached 302 would hand the next visitor somebody else's entry.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (!integrationSecret() || !portalBaseUrl()) {
    console.error("[ENTER] Portal bridge not configured (ODYSSEY_LEVEL1_SECRET / PORTAL_BASE_URL).");
    return redirect(res, "/?entry=unavailable");
  }

  const ticket = String(req.query?.ticket || "").trim();
  if (!ticket) return redirect(res, "/?entry=missing");

  // Shape check before spending a network round trip. Not a security control —
  // the Portal is the authority on whether a ticket is real — just a cheap filter.
  if (!/^[0-9a-f]{64}$/.test(ticket)) return redirect(res, "/?entry=invalid");

  try {
    const result = await redeemTicket(ticket, {
      requestId: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
    });

    if (!result.ok || !result.body || !result.body.accepted) {
      const code = (result.body && result.body.code) || result.code || "rejected";
      // Logged with the reason, shown to the participant as a category. The
      // distinction between "expired" and "already used" is genuinely useful to
      // them, and neither leaks anything.
      console.warn(`[ENTER] ticket rejected: ${code} (status ${result.status})`);
      const reason =
        code === "TICKET_EXPIRED"
          ? "expired"
          : code === "TICKET_SPENT"
            ? "used"
            : code === "LEVEL_NOT_LIVE"
              ? "closed"
              : "invalid";
      return redirect(res, `/?entry=${reason}`);
    }

    const { externalTeamRef, teamName } = result.body;
    if (!externalTeamRef) {
      console.error("[ENTER] Portal accepted the ticket but returned no team reference.");
      return redirect(res, "/?entry=invalid");
    }

    // The mapping. `upsertTeamForPortalRef` resolves an existing local team by
    // reference or creates one, atomically — two teammates entering at the same
    // instant cannot produce two local rows for one Portal squad.
    const team = await upsertTeamForPortalRef({ portalTeamRef: externalTeamRef, teamName });
    if (!team) {
      console.error("[ENTER] could not map Portal squad to a local team.");
      return redirect(res, "/?entry=error");
    }

    // Level 1 issues its OWN session, using the existing signed-cookie mechanism
    // this application already uses everywhere. Deliberately not a Portal session
    // and not a Portal credential: the two systems stay independent after the
    // hop, so a Portal outage mid-event does not log 60 crews out of Level 1.
    setCookie(res, "sb_team", signTeamCookie(team.code), { maxAgeSeconds: 8 * 60 * 60 });

    return redirect(res, "/hub");
  } catch (err) {
    console.error("[ENTER] entry failed:", err.message);
    return redirect(res, "/?entry=error");
  }
}
