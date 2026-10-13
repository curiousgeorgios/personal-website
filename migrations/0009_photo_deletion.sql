ALTER TABLE photos ADD COLUMN deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at > 0);

-- A deletion must remain hidden even while an older Worker or import is still running.
CREATE TRIGGER photos_deleted_insert BEFORE INSERT ON photos
WHEN NEW.deleted_at IS NOT NULL AND NEW.published != 0
BEGIN
  SELECT RAISE(ABORT, 'deleted photos cannot be published');
END;

CREATE TRIGGER photos_deleted_update BEFORE UPDATE OF published, deleted_at ON photos
WHEN NEW.deleted_at IS NOT NULL AND NEW.published != 0
BEGIN
  SELECT RAISE(ABORT, 'deleted photos cannot be published');
END;
