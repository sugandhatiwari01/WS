function notFound(req, res) { res.status(404).json({ error: "Route not found" }); }
function errorHandler(err, req, res, next) {
  if (err.code === 11000) return res.status(409).json({ error: "A record with that value already exists" });
  if (err.name === "ValidationError") return res.status(400).json({ error: err.message });
  console.error(err);
  const status = err.status || 500;
  const payload = { error: status === 500 && process.env.NODE_ENV === "production" ? "Internal server error" : (err.message || "Internal server error") };
  res.status(status).json(payload);
}
module.exports = { notFound, errorHandler };
