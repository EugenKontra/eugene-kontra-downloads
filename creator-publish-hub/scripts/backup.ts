import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { dataDir } from "../src/lib/config";

/** Consistent online SQLite backup (safe while app and worker are running). Videos are not included. */
const dir = path.resolve(process.argv[2] ?? path.join(dataDir(), "..", "backups"));
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `hub-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
await db().backup(file);
console.log(`Резервная копия базы: ${file}`);
console.log("Важно: сохраните также ENCRYPTION_KEY из .env — без него токены в копии не расшифровать.");
