const { customAlphabet } = require("nanoid");

// Excludes visually ambiguous characters (0/O, 1/I/L) since these codes get
// printed on cards and read aloud in a noisy room. Unguessable matters here:
// a team must not be able to walk into another team's session by guessing —
// so codes are random, not sequential (never TEAM01, TEAM02, ...).
const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const generate = customAlphabet(alphabet, 6);

function newTeamCode() {
  return `ODYSSEY-${generate()}`;
}

module.exports = { newTeamCode };
