import { Router } from "express";
import { sendWebhookEvent, type EventType } from "../lib/webhook";

const router = Router();

const ALLOWED_EVENTS = new Set<EventType>([
  "user.created",
  "document.uploaded",
  "opportunity.viewed",
  "opportunity.analyzed",
  "opportunity.saved",
  "opportunity.applied",
  "opportunity.outcome",
]);

router.post("/events", async (req, res): Promise<void> => {
  const { event_type, source_user_id, data } = req.body ?? {};

  if (!event_type || !ALLOWED_EVENTS.has(event_type)) {
    res.status(400).json({ error: "Invalid or missing event_type" });
    return;
  }

  if (!source_user_id) {
    res.status(400).json({ error: "source_user_id is required" });
    return;
  }

  res.status(202).json({ queued: true });

  sendWebhookEvent(event_type, source_user_id, data ?? {}).catch(() => {});
});

export default router;
