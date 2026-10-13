CREATE TABLE photo_posts (
  collection TEXT PRIMARY KEY,
  published_at INTEGER NOT NULL UNIQUE,      -- seconds since 1970, from Instagram
  published_on TEXT NOT NULL,                -- YYYY-MM-DD in the post's own offset
  place TEXT,                                -- "area, city" or null
  place_edited INTEGER NOT NULL DEFAULT 0 CHECK (place_edited IN (0, 1))
);
ALTER TABLE photos ADD COLUMN raw_review INTEGER NOT NULL DEFAULT 0 CHECK (raw_review IN (0, 1));

ALTER TABLE photo_download_grants ADD COLUMN note TEXT;
ALTER TABLE photo_download_grants ADD COLUMN request_nonce TEXT;
CREATE UNIQUE INDEX photo_grants_nonce ON photo_download_grants(request_nonce);
