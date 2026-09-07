const { COOKIE_NAME, isValidAdminCookieValue } = require("./adminAuth");

// Returns true and lets the caller continue if the request carries a valid
// admin cookie; otherwise sends 401 itself and returns false, so every
// admin route can just do `if (!requireAdmin(req, res)) return;` as its
// first line.
function requireAdmin(req, res) {
  const value = req.cookies?.[COOKIE_NAME];
  if (!isValidAdminCookieValue(value)) {
    res.status(401).json({ error: "not_authenticated" });
    return false;
  }
  return true;
}

module.exports = { requireAdmin };
