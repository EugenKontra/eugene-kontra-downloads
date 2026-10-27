import { handle, json } from "@/lib/api";
import { listTargets } from "@/lib/views";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "active";
  if (scope === "calendar") {
    const from = Number(url.searchParams.get("from")), to = Number(url.searchParams.get("to"));
    return json(listTargets("COALESCE(t.scheduled_at, t.finished_at) BETWEEN ? AND ? AND t.status != 'cancelled'", [from, to], "COALESCE(t.scheduled_at, t.finished_at) ASC", 2000));
  }
  if (scope === "history") return json(listTargets("t.status IN ('published','failed','cancelled','action_required')", [], "COALESCE(t.finished_at, t.updated_at) DESC", 500));
  return json(listTargets("t.status IN ('scheduled','queued','uploading','processing','action_required','failed')", [], "COALESCE(t.next_attempt_at, t.scheduled_at, t.updated_at) ASC"));
});
