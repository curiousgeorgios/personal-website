CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  position INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  previews TEXT NOT NULL CHECK (json_valid(previews)),
  print_key TEXT NOT NULL,
  print_width INTEGER NOT NULL CHECK (print_width > 0),
  print_height INTEGER NOT NULL CHECK (print_height > 0),
  print_bytes INTEGER NOT NULL CHECK (print_bytes > 0),
  print_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX photos_catalogue ON photos(published, position);
CREATE INDEX photos_collection ON photos(published, collection, position);

CREATE TABLE photo_download_grants (
  id TEXT PRIMARY KEY,
  photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
