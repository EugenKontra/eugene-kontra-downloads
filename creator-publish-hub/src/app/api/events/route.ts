import { handle, json } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = handle(async () => json(db().prepare(`
  SELECT e.id, e.ts, e.level, e.message, e.data_json, e.target_id, a.label AS account_label, a.platform
  FROM events e LEFT JOIN targets t ON t.id = e.target_id LEFT JOIN accounts a ON a.id = t.account_id
  ORDER BY e.ts DESC LIMIT 300`).all()));
