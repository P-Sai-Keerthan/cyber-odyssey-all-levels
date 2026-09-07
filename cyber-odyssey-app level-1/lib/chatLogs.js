const { query } = require("./db");

async function addChatLog(teamId, role, content, matched) {
  await query(
    `INSERT INTO chat_logs (team_id, role, content, matched) VALUES ($1, $2, $3, $4)`,
    [teamId, role, content, matched || null]
  );
}

async function getRecentChatTimestamps(teamId, sinceMs) {
  const { rows } = await query(
    `SELECT created_at FROM chat_logs
     WHERE team_id = $1 AND role = 'team' AND created_at > now() - ($2 || ' milliseconds')::interval
     ORDER BY created_at DESC`,
    [teamId, sinceMs]
  );
  return rows.map((r) => r.created_at);
}

async function getChatHistory(teamId, limit = 50) {
  const { rows } = await query(
    `SELECT role, content, created_at FROM chat_logs WHERE team_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [teamId, limit]
  );
  return rows;
}

module.exports = { addChatLog, getRecentChatTimestamps, getChatHistory };
