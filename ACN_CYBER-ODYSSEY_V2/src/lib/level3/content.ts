/**
 * Level 3 participant-facing copy.
 *
 * These are the DEFAULTS shipped with the build. They exist so the level reads
 * correctly the moment it is switched on, before a Creator has written anything —
 * an empty brief on event day is worse than a generic one.
 *
 * Creator-authored overrides are not wired up yet; when they are, they belong in
 * the database and these become the fallback. Keeping the strings here rather
 * than inline in the component means that change touches one file and no JSX.
 *
 * Deliberately free of challenge specifics: no target addresses, no bug names, no
 * hint content. Those come from `Level3Station` and `Level3Bug` records so they
 * can be changed without a redeploy.
 */

export const LEVEL3_DEFAULT_BRIEF = `The trail you followed through Levels 1 and 2 ends at a live web application — the system the adversary used to move through ORION's network.

Your squad has authorisation to investigate it. Work through the stations, find the vulnerabilities that let the intrusion happen, and prove each one. The challenge environment verifies your findings as you make them; there is nothing to submit here for an individual bug.

When you have exhausted what you can find, write it up. The final report is what an evaluator reads, and it is where you explain what you found, where, and why it matters.`;

export const LEVEL3_DEFAULT_SUBMISSION_INSTRUCTIONS = `Submit one report covering your whole Level 3 investigation. For each vulnerability you found, include:

• the bug identifier and where in the application it lives
• what the vulnerability is, in your own words
• how you confirmed it — the request, payload or steps you used
• the evidence supporting it (screenshots, responses, logs)
• what an attacker could do with it, and what you would recommend

Submit before the timer ends. You can replace your report as many times as you need until then — the last version you upload is the one evaluated. After the deadline no further uploads or replacements are accepted.

An evaluator scores your report and an Admin approves that score before it reaches the leaderboard. Your bug points are already counted and are not affected by this.`;
