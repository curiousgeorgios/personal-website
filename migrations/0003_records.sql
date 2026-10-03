-- The starting crate: the four tracks from the agreed prototype. Their media is in media/ and in R2 under these keys
-- (bun run seed:media). Like 0002, this is both production content and the e2e fixture; change records through /admin.
INSERT INTO records (title, artist, audio_key, cover_key, position) VALUES
  ('simple things', 'loom room', 'audio/simple-things.mp3', 'covers/simple-things.webp', 1),
  ('nyc in 1940', 'berlioz, ted jasper', 'audio/nyc-in-1940.mp3', 'covers/nyc-in-1940.webp', 2),
  ('no bad feelings today', 'juando', 'audio/no-bad-feelings-today.mp3', 'covers/no-bad-feelings-today.webp', 3),
  ('light it up', 'home alone.', 'audio/light-it-up.mp3', 'covers/light-it-up.webp', 4);
