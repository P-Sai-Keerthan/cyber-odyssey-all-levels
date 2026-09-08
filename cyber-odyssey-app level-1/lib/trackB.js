// Track B — "Session Hijack": the credential phished in Track A gets used
// to log into Ithaca Holdings' internal wiki, and the session token from
// that login turns up in a network capture. One JWT, three questions, each
// decoding a different segment of it — same "one artifact, three angles"
// shape as Track A, just a much shorter fuse (15 min total, entry-level).
//
// The token: header carries `kid` (key ID) pointing at a legacy/dev
// signing key that should never be in production; payload carries a
// realistic bundle of claims (iss/aud/sub/email/department/role/
// mfa_verified/session_id/iat/exp) so it reads like an actual intercepted
// token, not a two-field toy example.
//
//   B1 — decode the payload, find the username (sub)              [warm-up]
//   B2 — decode the payload, find the claimed privilege (role)    [the actual finding]
//   B3 — decode the header, find the signing key id (kid)         [why the token can't be trusted at all]
//
// None of the three answers are common security words (unlike, say,
// "alg: none") — they're all specific strings unique to this token, so
// nobody can blind-guess past the base64 step. Every question shares the
// same hint (which tool to use to decode this) since that's genuinely the
// only friction point here — once a team knows to reach for jwt.io, all
// three questions become a five-minute read.

const { MAX_ATTEMPTS, HINT_PENALTY } = require("./trackShared");

const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLy4uL2V0Yy9rZXlzL2xlZ2FjeS1kZXYtMjAxOS5wZW0ifQ." +
  "eyJpc3MiOiJhdXRoLml0aGFjYWhvbGRpbmdzLmNvbSIsImF1ZCI6Indpa2ktaW50ZXJuYWwiLCJzdWIiOiJqLmFsdmFyZXoiLCJlbWFpbCI6ImouYWx2YXJlekBpdGhhY2Fob2xkaW5ncy5jb20iLCJkZXBhcnRtZW50IjoiSVQgU3VwcG9ydCIsInNjb3BlcyI6WyJ1c2VyOnJlYWQiLCJ3aWtpOndyaXRlIiwiYWRtaW46b3ZlcnJpZGVfNzczIl0sIm1mYV92ZXJpZmllZCI6ZmFsc2UsInNlc3Npb25faWQiOiJhMTNmOWUyYy04OGIyLTRkNjEtOWE0Zi0yMDFjN2U1NTkwYWEiLCJpYXQiOjE3NzA4ODY4MDAsIm5iZiI6MTc3MDg4NzQwMCwiZXhwIjoxNzcwODkwNDAwfQ." +
  "kR3f9pQzT1lM7v2XyB0eJdC4wNs8Ah6rUoYgKpLmZ9E";

const HEADER = { alg: "HS256", typ: "JWT", kid: "../../etc/keys/legacy-dev-2019.pem" };
const PAYLOAD = {
  iss: "auth.ithacaholdings.com",
  aud: "wiki-internal",
  sub: "j.alvarez",
  email: "j.alvarez@ithacaholdings.com",
  department: "IT Support",
  scopes: ["user:read", "wiki:write", "admin:override_773"],
  mfa_verified: false,
  session_id: "a13f9e2c-88b2-4d61-9a4f-201c7e5590aa",
  iat: 1770886800,
  nbf: 1770887400,
  exp: 1770890400,
};

const TOOL_HINT =
  "Paste the whole token into jwt.io — no login needed, it splits and " +
  "decodes the header and payload panels instantly. (In a real " +
  "investigation you'd never paste an ACTUAL production token into a " +
  "public site — you'd hand your own session to a third party — but this " +
  "one's a fictional exercise token with nothing real behind it, so it's " +
  "a safe place to build the habit of knowing when that's OK and when " +
  "it isn't.)";

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function checkB1(answer) {
  const text = norm(answer);
  return /^(50|50\s*(mins?|minutes?))$/.test(text);
}
function checkB2(answer) {
  const text = norm(answer);
  return text.includes("admin:override_773") || text.includes("admin:override");
}
function checkB3(answer) {
  const text = norm(answer);
  return text.includes("../../etc/keys/legacy-dev-2019.pem") || text.includes("legacy-dev-2019");
}
function checkB4(answer) {
  const text = norm(answer);
  return text.includes("public key") || text.includes("rsa public key") || text.includes("public_key") || text.includes("pubkey");
}

const QUESTIONS = {
  B1: {
    code: "B1",
    points: 5,
    title: "Usable Session Duration ('nbf' Clock Skew)",
    prompt:
      "The JWT payload contains iat: 1770886800, exp: 1770890400 (+60 mins), AND an nbf (Not Before) claim set to 1770887400 (+10 mins after issuance). " +
      "Automated scripts subtract exp - iat (60 mins). Calculate the ACTUAL usable session validity duration in minutes between nbf and exp.",
    placeholder: "Enter your answer here...",
    hint: TOOL_HINT,
    check: checkB1,
  },
  B2: {
    code: "B2",
    points: 5,
    title: "Scope Permission Array Override",
    prompt:
      "Privilege is passed inside a scopes permission array in the JWT payload. " +
      "Decode the token payload and inspect the scopes array. What specific scope string grants unauthorized administrative override access?",
    placeholder: "Enter your answer here...",
    hint: TOOL_HINT,
    check: checkB2,
  },
  B3: {
    code: "B3",
    points: 10,
    title: "Key ID Path Traversal Audit",
    prompt:
      "Inspect the JWT header 'kid' field. An attacker performed a directory traversal injection to load a legacy dev key file from the host filesystem. " +
      "What is the FULL unformatted 'kid' header string containing the traversal path?",
    placeholder: "Enter your answer here...",
    hint: TOOL_HINT,
    check: checkB3,
  },
  B4: {
    code: "B4",
    points: 10,
    title: "Algorithm Confusion Attack Vector",
    prompt:
      "In a classic JWT Algorithm Confusion attack (changing alg from RS256 to HS256), " +
      "what public component of the server's asymmetric keypair is exploited by the attacker as the HMAC symmetric secret key to re-sign the token?",
    placeholder: "Enter your answer here...",
    hint: TOOL_HINT,
    check: checkB4,
  },
};

const QUESTION_ORDER = ["B1", "B2", "B3", "B4"];
const TOTAL_POINTS = QUESTION_ORDER.reduce((sum, k) => sum + QUESTIONS[k].points, 0);

function checkAnswer(questionCode, answer) {
  const q = QUESTIONS[questionCode];
  if (!q) return false;
  return q.check(answer);
}

module.exports = {
  QUESTIONS,
  QUESTION_ORDER,
  TOTAL_POINTS,
  MAX_ATTEMPTS,
  HINT_PENALTY,
  TOKEN,
  checkAnswer,
};
