# Deleted photos stay out of the catalogue

Status: Accepted
Date: 2026-10-13

## Context

George asked to delete photographs from `/admin`. Hide already removes a photograph from public views but leaves it in the admin and allows publish all to bring it back. Removing the database row or its private master would also break existing print orders and could let a later import recreate the photograph.

## Decision

Delete records `photos.deleted_at` and sets publication to zero. Deleted photographs leave the admin list, gallery, public previews and catalogue downloads. They cannot be published or edited through stale forms. Imports leave their rows unchanged, including the master an existing order uses. The admin's delete form requires its confirmation checkbox, while the JSON DELETE route requires `{ "confirm": true }`. Both use the existing owner and same-origin gates and purge the gallery, home page and photograph's preview cache tag.

The row and stored files remain for order history and fulfilment. This operation deletes a photograph from the catalogue, rather than erasing storage or local originals. The confirmation explains this distinction. There is no restore control or automatic deletion of stored files in this change. Copies already downloaded or cached in a visitor's browser cannot be recalled.

A database trigger prevents a deleted photograph becoming published, including during a deployment with older code running. A publish that races a deletion fails for the entire requested set.

## Validation and release

Unit tests cover public and admin visibility, cache purges, repeat requests, re-import, stale edits, a concurrent publish and existing order grants and items. The browser test checks the confirmation and removal with JavaScript disabled, plus cross-site refusal. Migration `0009_photo_deletion.sql` must run before the new Worker is deployed. Tests use synthetic photographs only.
