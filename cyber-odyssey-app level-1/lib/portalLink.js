/**
 * Where "Return to Portal" sends a participant.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE VARIABLE FROM PORTAL_BASE_URL
 * ---------------------------------------------------------------------------
 * `PORTAL_BASE_URL` is used by lib/portalClient.js for SERVER-to-server calls.
 * It is deliberately not exposed to the browser, and Next.js will not inline it
 * into a client bundle — `process.env.PORTAL_BASE_URL` evaluates to `undefined`
 * in a component.
 *
 * These links are rendered in the browser, so they need the `NEXT_PUBLIC_`
 * prefix, which is Next's own mechanism for "this value may be public". The two
 * normally hold the same address; they are separate because one crosses a trust
 * boundary and the other does not.
 *
 * Previously three pages each hardcoded `http://localhost:3002`. That is wrong
 * twice over: it breaks the moment the portal is not on that port, and it
 * silently ships a developer's local address to an event deployment.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A FALLBACK HERE BUT NOT ON THE PORTAL SIDE
 * ---------------------------------------------------------------------------
 * The portal refuses to build an entry URL without configuration, because
 * guessing would send participants somewhere that is probably wrong. This is the
 * opposite case: it is a "go back" link shown on an error screen. A link to a
 * plausible default is strictly better than no escape route at all, and being
 * wrong costs a participant one click.
 */

const DEFAULT_PORTAL_URL = 'http://localhost:3002';

/** The portal origin, with any trailing slash removed. */
function portalOrigin() {
  const configured = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  const value = typeof configured === 'string' ? configured.trim() : '';
  return (value || DEFAULT_PORTAL_URL).replace(/\/+$/, '');
}

/** The portal's Level 1 page — where a participant came from, and can return to. */
function portalLevel1Url() {
  return `${portalOrigin()}/event/level-1`;
}

module.exports = { portalOrigin, portalLevel1Url, DEFAULT_PORTAL_URL };
