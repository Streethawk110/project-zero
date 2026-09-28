-- Grundschema: Konten, Sitzungen, Online-Charaktere, Protokoll
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_login INTEGER,
  banned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  data TEXT NOT NULL,
  level INTEGER NOT NULL,
  zone TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_name ON characters(name) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  account_id TEXT,
  char_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
