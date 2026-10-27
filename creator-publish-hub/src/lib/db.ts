import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    label TEXT NOT NULL,
    external_id TEXT,
    display_name TEXT,
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    expires_at INTEGER,
    refresh_expires_at INTEGER,
    scopes TEXT,
    status TEXT NOT NULL DEFAULT 'connected',
    status_message TEXT,
    options_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime TEXT,
    received INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploading',
    meta_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    video_id TEXT REFERENCES videos(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE targets (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL DEFAULT '{}',
    scheduled_at INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    lease_until INTEGER,
    state_json TEXT NOT NULL DEFAULT '{}',
    external_id TEXT,
    url TEXT,
    error_code TEXT,
    error_message TEXT,
    progress REAL,
    started_at INTEGER,
    finished_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (post_id, account_id)
  );
  CREATE INDEX targets_status ON targets(status, next_attempt_at);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT
  );
  CREATE INDEX events_target ON events(target_id, ts);
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'any',
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    label TEXT NOT NULL,
    account_id TEXT,
    verifier TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const d = new Database(path.join(dir, "hub.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 5000");
  d.pragma("foreign_keys = ON");
  migrate(d);
  instance = d;
  return d;
}

/** For tests only. */
export function closeDb() {
  instance?.close();
  instance = null;
}

function migrate(d: Database.Database) {
  const version = d.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    d.transaction(() => {
      d.exec(MIGRATIONS[i]);
      d.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function kvGet(key: string): string | null {
  const row = db().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(key: string, value: string) {
  db().prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
