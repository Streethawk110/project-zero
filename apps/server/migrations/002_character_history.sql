-- Sicherungskopien der letzten Charakterstände (Schutz gegen Fehlbedienung/Datenverlust)
CREATE TABLE IF NOT EXISTS character_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS character_history_char ON character_history(char_id, ts);
