const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { jwtSecret } = require("./config");
function createSocketServer(httpServer) {
  const io = new Server(httpServer, { cors: { origin: process.env.CORS_ORIGIN || "*" } });
  io.use((socket, next) => {
    try { const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, ""); socket.user = jwt.verify(token, jwtSecret); next(); } catch (_) { next(new Error("Authentication required")); }
  });
  io.on("connection", socket => {
    const userId = socket.user.sub;
    socket.join(`user:${userId}`);
    if (socket.user.role === "family") socket.join(`family:${userId}`);
    if (socket.user.role === "police" || socket.user.role === "responder") socket.join("police");
    socket.on("emergency:join", id => socket.join(`emergency:${id}`));
    socket.on("emergency:leave", id => socket.leave(`emergency:${id}`));
  });
  return io;
}
module.exports = { createSocketServer };
