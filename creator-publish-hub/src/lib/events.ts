import { db } from "./db";
import { sanitize } from "./platforms/http";

export function logEvent(targetId: string | null, level: "info" | "warn" | "error", message: string, data?: unknown) {
  db().prepare("INSERT INTO events(target_id, ts, level, message, data_json) VALUES(?, ?, ?, ?, ?)")
    .run(targetId, Date.now(), level, message, data === undefined ? null : JSON.stringify(sanitize(data)));
}
