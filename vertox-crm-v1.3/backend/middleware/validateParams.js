// Rejects a route param that isn't a positive integer BEFORE it reaches a
// SQL query. Without this, something like GET /api/records/single/abc lets
// "abc" flow into `.input('id', sql.Int, 'abc')`, which the mssql driver
// throws on as a raw, unhandled conversion error (500 with a stack trace
// leaking to the client) instead of a clean, expected 400 response.
function requireIntParam(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (!/^\d+$/.test(String(value))) {
      return res.status(400).json({ message: `Invalid ${paramName}: must be a positive whole number` });
    }
    next();
  };
}

module.exports = { requireIntParam };
