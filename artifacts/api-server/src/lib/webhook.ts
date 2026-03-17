import crypto from "crypto";

const ENDPOINT =
  "https://xeskrwkcpoqptkkrrjci.supabase.co/functions/v1/eiaas-webhook-receiver/rfp-matcher";

const SECRET = process.env["OPPORTUNILYNK_SECRET"] ?? "";

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export type EventType =
  | "user.created"
  | "document.uploaded"
  | "opportunity.viewed"
  | "opportunity.analyzed"
  | "opportunity.saved"
  | "opportunity.applied"
  | "opportunity.outcome";

export interface WebhookPayload {
  event_type: EventType;
  source_user_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function sendWebhookEvent(
  event_type: EventType,
  source_user_id: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!SECRET) {
    console.warn("[webhook] OPPORTUNILYNK_SECRET not set — skipping event:", event_type);
    return;
  }

  const payload: WebhookPayload = {
    event_type,
    source_user_id,
    timestamp: new Date().toISOString(),
    data,
  };

  const body = JSON.stringify(payload);
  const signature = sign(body);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-signature": signature,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[webhook] ${event_type} → HTTP ${res.status}`, text.slice(0, 200));
    } else {
      console.log(`[webhook] ${event_type} → OK`);
    }
  } catch (err) {
    console.error("[webhook] send failed:", err);
  }
}
