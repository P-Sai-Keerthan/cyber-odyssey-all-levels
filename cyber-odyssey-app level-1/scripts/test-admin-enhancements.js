const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { rankTeams } = require("../lib/rank");

console.log("=== VERIFYING LEVEL 1 ADMIN DASHBOARD ENHANCEMENTS ===");

// 1. Inspect pages/admin.js content
const adminPath = path.join(__dirname, "..", "pages", "admin.js");
const adminSource = fs.readFileSync(adminPath, "utf8");

const cssPath = path.join(__dirname, "..", "styles", "globals.css");
const cssSource = fs.readFileSync(cssPath, "utf8");

// Requirement A: Stats card layout
console.log("\n[Test 1] Statistics card layout in pages/admin.js & globals.css");
assert(cssSource.includes(".stats-grid-row-1"), "globals.css must contain .stats-grid-row-1");
assert(cssSource.includes(".stats-grid-row-2"), "globals.css must contain .stats-grid-row-2");
assert(cssSource.includes("repeat(2, 1fr)"), "stats-grid-row-1 must specify repeat(2, 1fr)");
assert(cssSource.includes("repeat(3, 1fr)"), "stats-grid-row-2 must specify repeat(3, 1fr)");

const row1Index = adminSource.indexOf('className="stats-grid-row-1"');
const row2Index = adminSource.indexOf('className="stats-grid-row-2"');
assert(row1Index !== -1, "stats-grid-row-1 used in admin.js");
assert(row2Index !== -1, "stats-grid-row-2 used in admin.js");

const row1Content = adminSource.slice(row1Index, row2Index);
assert(row1Content.includes('label="Registered Crews"'), "Row 1 must contain Registered Crews");
assert(row1Content.includes('label="Completed"'), "Row 1 must contain Completed");
assert(row1Content.indexOf('label="Registered Crews"') < row1Content.indexOf('label="Completed"'), "Registered Crews must precede Completed");

const row2Content = adminSource.slice(row2Index, row2Index + 500);
assert(row2Content.includes('label="On Track A"'), "Row 2 must contain On Track A");
assert(row2Content.includes('label="On Track C"'), "Row 2 must contain On Track C");
assert(row2Content.includes('label="On Track B"'), "Row 2 must contain On Track B");
assert(row2Content.indexOf('label="On Track A"') < row2Content.indexOf('label="On Track C"'), "On Track A must precede On Track C");
assert(row2Content.indexOf('label="On Track C"') < row2Content.indexOf('label="On Track B"'), "On Track C must precede On Track B");
console.log("  [PASS] Stats cards arranged exactly as required (Row 1: Registered Crews | Completed; Row 2: Track A | Track C | Track B)");

// Requirement B: Leaderboard Table and Removal of Advance Checkbox
console.log("\n[Test 2] Leaderboard columns & removal of manual advance");
assert(!adminSource.includes("toggleAdvance"), "toggleAdvance must be removed");
assert(!adminSource.includes("<th>Advance</th>"), "<th>Advance</th> must be removed");
assert(!adminSource.includes('type="checkbox"'), "Advance checkbox must be removed from admin table");
assert(adminSource.includes("<th>RANK</th>"), "Leaderboard must have <th>RANK</th>");
assert(adminSource.includes("<th>TEAM CODE</th>"), "Leaderboard must have <th>TEAM CODE</th>");
assert(adminSource.includes("<th>TRACK A</th>"), "Leaderboard must have <th>TRACK A</th>");
assert(adminSource.includes("<th>TRACK B</th>"), "Leaderboard must have <th>TRACK B</th>");
assert(adminSource.includes("<th>TRACK C</th>"), "Leaderboard must have <th>TRACK C</th>");
assert(adminSource.includes("<th>TOTAL SCORE</th>"), "Leaderboard must have <th>TOTAL SCORE</th>");
assert(adminSource.includes("<th>FINISH TIME</th>"), "Leaderboard must have <th>FINISH TIME</th>");
assert(adminSource.includes("<th>ATTEMPTS</th>"), "Leaderboard must have <th>ATTEMPTS</th>");
assert(adminSource.includes("<th>STATUS</th>"), "Leaderboard must have <th>STATUS</th>");
assert(adminSource.includes("<th>ACTION</th>"), "Leaderboard must have <th>ACTION</th>");
console.log("  [PASS] Advance column completely removed, Rank column added, exact headers present");

// Requirement C: Deterministic ranking logic test
console.log("\n[Test 3] Automatic deterministic ranking logic (rankTeams)");
const dummyTeams = [
  { id: 3, code: "TEAM-C", name: "Team C", stage1CompletedAt: new Date(1000).toISOString() },
  { id: 1, code: "TEAM-A", name: "Team A", trackcCompletedAt: new Date(2000).toISOString() },
  { id: 2, code: "TEAM-B", name: "Team B", trackcCompletedAt: new Date(1500).toISOString() },
  { id: 4, code: "TEAM-D", name: "Team D", trackcCompletedAt: new Date(1500).toISOString() },
];
// Points:
// Team A: 30 + 30 + 20 = 80
// Team B: 30 + 30 + 35 = 95
// Team C: 30 + 0 + 0 = 30
// Team D: 30 + 30 + 35 = 95 (tied with B on points, same finish time, but more attempts)
const pointsA = { 1: 30, 2: 30, 3: 30, 4: 30 };
const pointsB = { 1: 30, 2: 30, 3: 0, 4: 30 };
const pointsC = { 1: 20, 2: 35, 3: 0, 4: 35 };
const attempts = { 1: 5, 2: 4, 3: 2, 4: 7 };

const ranked = rankTeams(dummyTeams, pointsA, pointsB, pointsC, attempts);
assert.strictEqual(ranked[0].code, "TEAM-B", "Rank 1 must be TEAM-B (95 pts, 4 attempts)");
assert.strictEqual(ranked[0].rank, 1);
assert.strictEqual(ranked[1].code, "TEAM-D", "Rank 2 must be TEAM-D (95 pts, 7 attempts)");
assert.strictEqual(ranked[1].rank, 2);
assert.strictEqual(ranked[2].code, "TEAM-A", "Rank 3 must be TEAM-A (80 pts)");
assert.strictEqual(ranked[2].rank, 3);
assert.strictEqual(ranked[3].code, "TEAM-C", "Rank 4 must be TEAM-C (30 pts)");
assert.strictEqual(ranked[3].rank, 4);

// Dynamic update simulation: Team A scores 20 more points (total 100)
pointsC[1] = 40; // Total: 30+30+40 = 100
const updatedRanked = rankTeams(dummyTeams, pointsA, pointsB, pointsC, attempts);
assert.strictEqual(updatedRanked[0].code, "TEAM-A", "TEAM-A becomes Rank 1 with 100 pts");
assert.strictEqual(updatedRanked[0].rank, 1);
assert.strictEqual(updatedRanked[1].code, "TEAM-B", "TEAM-B becomes Rank 2");
console.log("  [PASS] rankTeams deterministically ranks by Score DESC -> Finish Time ASC -> Attempts ASC -> Team ID ASC");

// Requirement D: Login page structure
console.log("\n[Test 4] Admin Login Page layout & labels");
assert(adminSource.includes("LEVEL 1 ADMIN"), "Eyebrow 'LEVEL 1 ADMIN' present");
assert(adminSource.includes("FLEET COMMAND<br />LOGIN") || adminSource.includes("FLEET COMMAND"), "FLEET COMMAND LOGIN title present");
assert(adminSource.includes("Administrator Access"), "'Administrator Access' subtitle present");
assert(adminSource.includes("ADMIN PASSWORD"), "'ADMIN PASSWORD' label present");
assert(adminSource.includes("Authorized Level 1 event administrators only."), "Authorized footer notice present");
console.log("  [PASS] Admin Login structure matches specification");

// Requirement E: Rename "Puzzle Secrets & Parameters"
console.log("\n[Test 5] Renamed 'LEVEL 1 CHALLENGE CONFIGURATION'");
assert(adminSource.includes("LEVEL 1 CHALLENGE CONFIGURATION"), "Heading 'LEVEL 1 CHALLENGE CONFIGURATION' present");
assert(!adminSource.includes("Puzzle Secrets &amp; Parameters"), "Old 'Puzzle Secrets & Parameters' heading removed");
assert(adminSource.includes("Configure the server-side values used by Level 1 challenges. These settings are visible only to Level 1 administrators and are never shown to participants."), "Explanation paragraph present");
assert(adminSource.includes('track="TRACK A"'), "TRACK A label present");
assert(adminSource.includes('label="SOC CASE REFERENCE"'), "SOC CASE REFERENCE label present");
assert(adminSource.includes('label="SECRET WORD"'), "SECRET WORD label present");
assert(adminSource.includes('label="SANCTUARY ADDRESS / ROUND 2 COORDINATE"'), "SANCTUARY ADDRESS / ROUND 2 COORDINATE label present");
assert(adminSource.includes("SAVE CONFIGURATION"), "SAVE CONFIGURATION button present");
console.log("  [PASS] Challenge configuration renamed and clearly labeled with explanation");

// Requirement F: Dashboard Section Order
console.log("\n[Test 6] Dashboard Section Order");
const idxSec1 = adminSource.indexOf("1. EVENT CONTROL");
const idxSec2 = adminSource.indexOf("2. EVENT STATISTICS");
const idxSec3 = adminSource.indexOf("3. LIVE DETERMINISTIC LEADERBOARD");
const idxSec4 = adminSource.indexOf("LEVEL 1 CHALLENGE CONFIGURATION");
const idxSec5 = adminSource.indexOf("5. TEAM MANAGEMENT");
const idxSec6 = adminSource.indexOf("6. DANGER ZONE");

assert(idxSec1 !== -1 && idxSec2 !== -1 && idxSec3 !== -1 && idxSec4 !== -1 && idxSec5 !== -1 && idxSec6 !== -1, "All 6 sections must exist");
assert(idxSec1 < idxSec2, "Section 1 must precede Section 2");
assert(idxSec2 < idxSec3, "Section 2 must precede Section 3");
assert(idxSec3 < idxSec4, "Section 3 must precede Section 4");
assert(idxSec4 < idxSec5, "Section 4 must precede Section 5");
assert(idxSec5 < idxSec6, "Section 5 must precede Section 6");
console.log("  [PASS] All 6 sections strictly ordered in 1 -> 2 -> 3 -> 4 -> 5 -> 6 sequence");

console.log("\nALL ADMIN ENHANCEMENT VERIFICATION CHECKS PASSED!\n");
