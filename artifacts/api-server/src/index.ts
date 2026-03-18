import "./loadEnv";
import app from "./app";

// Prevent Node from dumping the entire minified bundle when an uncaught error occurs
// (stack trace for a single-line file can be huge and hide the real error message).
function safeStack(err: unknown): string {
  if (err instanceof Error && err.stack) {
    const max = 2000;
    return err.stack.length <= max ? err.stack : err.stack.slice(0, max) + "\n... (stack truncated)";
  }
  return String(err);
}
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err instanceof Error ? err.message : err);
  console.error(safeStack(err));
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[unhandledRejection]", reason);
  console.error(safeStack(reason));
  process.exit(1);
});

// Default port (Railway sets PORT; local dev / Vite proxy often uses 8080).
const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Listen on 0.0.0.0 so Railway/external healthchecks can reach the server
const host = process.env["HOST"] ?? "0.0.0.0";
app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
