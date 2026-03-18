import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * Minimal healthcheck for Railway/deploy: no dependencies, no throws.
 * Always returns 200 with { status: "ok" } so the process is considered healthy.
 */
router.get("/healthz", (_req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    res.status(200).end(JSON.stringify({ status: "ok" }));
  } catch {
    // If anything unexpected happens, still respond 200 so healthcheck passes
    if (!res.headersSent) {
      res.status(200).setHeader("Content-Type", "application/json").end(JSON.stringify({ status: "ok" }));
    }
  }
});

export default router;
