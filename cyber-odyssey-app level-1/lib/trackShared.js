// Constants that apply across every track, not just one. Pulled out here
// once a second track needed them, so Track C (and beyond) import the same
// values instead of each guessing its own number.

// Three tries per question, then it locks at 0 points and the team moves
// on — see lib/teams.js#recordTrackAttempt for the atomic enforcement.
const MAX_ATTEMPTS = 3;

// Revealing a question's hint costs a flat 5 points off whatever it was
// worth, applied once at the moment of a correct answer (see
// pages/api/trackB/submit.js). Flat rather than proportional on purpose —
// easier for a team to reason about mid-competition than a percentage,
// even though it lands harder on a 5-point question than a 15-point one.
const HINT_PENALTY = 5; // Points deducted if a hint is revealed for a Track B question

module.exports = { MAX_ATTEMPTS, HINT_PENALTY };
