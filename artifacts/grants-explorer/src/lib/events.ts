/**
 * events.ts — Fire-and-forget wrapper for OpportuniLynk webhook events.
 *
 * All events are routed through the API server which handles HMAC signing.
 * Calls never throw and never block the UI — failures are silently swallowed.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

type EventType =
  | "user.created"
  | "document.uploaded"
  | "opportunity.viewed"
  | "opportunity.analyzed"
  | "opportunity.saved"
  | "opportunity.applied"
  | "opportunity.outcome";

function sendEvent(
  event_type: EventType,
  source_user_id: string,
  data: Record<string, unknown>,
): void {
  fetch(`${API}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, source_user_id, data }),
    keepalive: true,
  }).catch(() => {});
}

export const trackUserCreated = (userId: string, email: string) =>
  sendEvent("user.created", userId, {
    email,
    created_at: new Date().toISOString(),
  });

export const trackOpportunityViewed = (
  userId: string,
  opportunityId: string,
  title: string,
  source: string,
) =>
  sendEvent("opportunity.viewed", userId, {
    opportunity_id: opportunityId,
    title,
    source,
  });

export const trackOpportunityAnalyzed = (
  userId: string,
  opportunitiesScored: number,
  topScore: number,
  orgName: string,
) =>
  sendEvent("opportunity.analyzed", userId, {
    opportunities_scored: opportunitiesScored,
    top_score: topScore,
    org_name: orgName,
  });

export const trackOpportunitySaved = (
  userId: string,
  opportunityId: string,
  title: string,
  source: string,
  score?: number,
) =>
  sendEvent("opportunity.saved", userId, {
    opportunity_id: opportunityId,
    title,
    source,
    score: score ?? null,
  });

export const trackOpportunityApplied = (
  userId: string,
  opportunityId: string,
  title: string,
  source: string,
  score?: number,
) =>
  sendEvent("opportunity.applied", userId, {
    opportunity_id: opportunityId,
    title,
    source,
    score: score ?? null,
  });

export const trackOpportunityOutcome = (
  userId: string,
  opportunityId: string,
  outcome: "win" | "loss",
  title?: string,
) =>
  sendEvent("opportunity.outcome", userId, {
    opportunity_id: opportunityId,
    outcome: outcome === "win" ? "won" : "lost",
    title: title ?? null,
  });
