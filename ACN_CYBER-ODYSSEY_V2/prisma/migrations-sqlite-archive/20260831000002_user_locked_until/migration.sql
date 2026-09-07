-- =============================================================================
-- Phase 17 / SEC-17-02 — Explicit brute-force lockout expiry.
-- =============================================================================
--
-- Adds User.lockedUntil so a lockout has its own absolute expiry instead of
-- being derived from User.lastActivityAt.
--
-- The previous scheme treated an account as locked while
--   failedLoginCount >= 10 AND (now - lastActivityAt) < 15 minutes.
-- Because lastActivityAt is refreshed on every authenticated request, a victim
-- browsing the portal continuously renewed their own lock window. Ten wrong
-- password guesses by anyone were therefore enough to lock a participant out of
-- the event indefinitely.
--
-- Nullable with no default: existing rows become "not locked", which is the
-- correct and safe interpretation.
-- =============================================================================

ALTER TABLE "User" ADD COLUMN "lockedUntil" DATETIME;
