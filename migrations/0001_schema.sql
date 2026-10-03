CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL CHECK (section IN ('now', 'before')),
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  aside TEXT,
  label_era TEXT,
  label_status TEXT CHECK (label_status IN ('live', 'retired')),
  label_made_of TEXT,
  label_text TEXT,
  label_kind TEXT CHECK (label_kind IN ('decision', 'lesson')),
  label_note TEXT,
  snapshot_url TEXT,
  snapshot_key TEXT,
  snapshot_at TEXT,
  snapshot_status TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX items_section_position ON items (section, position);

CREATE TABLE log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  precision TEXT NOT NULL CHECK (precision IN ('day', 'month')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX log_entries_order ON log_entries (date DESC, created_at DESC, id DESC);

CREATE TABLE facts (
  key TEXT PRIMARY KEY CHECK (key IN ('shelf', 'kettle')),
  title TEXT NOT NULL,
  subtitle TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  cover_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX records_active_position ON records (active, position);
