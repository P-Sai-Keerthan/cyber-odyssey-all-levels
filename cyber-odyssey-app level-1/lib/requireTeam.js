const { getTeamCodeFromCookie } = require("./cookies");
const { getTeamByCode } = require("./teams");

async function getAuthenticatedTeam(req) {
  const raw = req.cookies?.sb_team;
  if (!raw) return null;
  const code = getTeamCodeFromCookie(raw);
  if (!code) return null;
  return getTeamByCode(code);
}

module.exports = { getAuthenticatedTeam };
