# Photo gallery backend

The backend supports public previews and private full-resolution JPEG downloads using revocable signed links. The initial selection contains 462 photos. Unmatched images and the 22 excluded lower-resolution sources are omitted from both previews and downloads.

## API for Claude's frontend

| Method and route | Behaviour |
| --- | --- |
| `GET /api/photos?after=-1&limit=24&collection=<optional>` | Published catalogue with `photos` and numeric `next` cursor. Limit: 1–48. |
| `GET /api/photos/<id>` | One published photograph. No private object key or bearer credential. |
| `GET /media/photos/previews/<id>/<sha>/<240\|480\|960\|1600>.<webp\|avif>` | Public versioned preview, served through the existing media route. |
| `GET /api/photos/downloads?token=<signed-token>&after=-1&limit=24` | Private catalogue for a catalogue-scoped grant, with protected `downloadUrl` values and `expiresAt`. |
| `GET` or `HEAD /photos/downloads/<id>?token=<signed-token>` | Approved full-resolution JPEG attachment. Supports byte ranges and conditional requests. |
| `GET /photos/downloads?token=<signed-token>` | The private downloads page: every published photograph with a download link. Never cached, indexed, counted or sent as a referrer; an invalid, expired or revoked link gets one 403 page. |
| `POST /admin/photos/links` | Issue a catalogue link to the downloads page, through the existing owner administration gate. A `photoId` is refused with 400: photo links are internal. |
| `DELETE /admin/photos/links?grantId=<uuid>` | Revoke a link through the owner gate. |
| `PATCH /admin/photos/<id>` | Publish or unpublish a prepared photograph after verifying its private JPEG and eight previews. |

Public photo fields: `id`, `collection`, `title`, `width`, `height`, `downloadBytes` and `previews`. Each preview has `url`, actual `width`/`height` and `format`. Titles initially contain an empty string for the UI to handle. Collections initially use Instagram post identifiers as provenance; no artistic titles were invented.

The public catalogue uses the `photos` cache tag. Publication endpoints invalidate it. `cacheInvalidated: false` means a write succeeded but public catalogue entries may remain cached for the configured 60-second fresh window plus 300-second stale window. Downloads check publication in D1 on each request.

Owner writes require a matching Origin header; request bodies require `application/json`. Link issuance accepts `{ "expiresInSeconds": 604800 }` and always issues a catalogue link; a `photoId` is refused with 400. Publication accepts `{ "published": true }`. JSON bodies are capped at 4 KB. Full-resolution links must not be embedded into public catalogue responses, external analytics, referrers or public static assets.

Use responsive previews, bounded catalogue batches and intrinsic image dimensions. Fetch full-resolution bytes only on a download action. The one page this backend serves is the private downloads page, which has no browser script and no link from any public page.

## Local preparation and import

Run from the website checkout under Node 24:

```bash
bun run photos:key
bun run db:migrate:local
bun run photos:prepare \
  --selection /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/metadata/gallery-selection.json \
  --index /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/photo-index.json \
  --output /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/gallery-assets
bun run photos:import \
  --manifest /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/gallery-assets/manifest.json \
  --selection /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/metadata/gallery-selection.json \
  --local
```

The preparation command requires macOS to render RAW/HEIC with Core Image. It prefers an exported Photos edit where available, otherwise the preferred original. It preserves source dimensions and orientation, creates a full-resolution sRGB JPEG with its ICC profile and strips EXIF/XMP/IPTC from delivery copies. Eight responsive variants (240, 480, 960 and 1600 pixels, in WebP and AVIF) are derived from that same JPEG. A checkpoint lets repeated preparations reuse completed assets; one from before the 240s gains them from its master without changing the master or its hash. A rendered RAW is a candidate edit, not proof of a colour/crop match to Instagram.

Prepared assets must live outside the website checkout. The import validates selection membership, image format, dimensions, SHA-256, profile and private metadata before any storage write. Objects are uploaded before their database row. New or changed masters stay unpublished; an unchanged master keeps its current publication state. `--persist-to` chooses a separate local store. No prepared photo file is committed to Git.

## Issuing links without Access

`photos:key` generates an ignored local key in `.dev.vars`, preserves an existing key and never prints it. People only ever get catalogue links (ADR-0020 as amended): a catalogue link lists only published photos, and photo-scoped grants are made inside the site.

```bash
bun run photos:link --local \
  --days 7 \
  --output /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/private-link.json
```

The link opens the downloads page, `/photos/downloads?token=…`; `--photo` is refused. The private JSON file contains the URL, grant identifier and expiry; its mode is 0600. The command refuses to save links into tracked areas of the website. George shares the link himself. To revoke it:

```bash
bun run photos:link --local --revoke <grant-id>
```

For production, use `--remote` and set `PHOTO_LINK_SECRET` securely in the process environment to the same key as the Worker. Do not print it, include it in a command-line argument or put it in a tracked environment file. The owner API can issue production links without exposing the signing key to the browser or local CLI.

## Production release prerequisites

No remote resources, uploads or release have been performed by this implementation pass.

1. Create the `curiousgeorge-photo-prints` bucket and verify it has no public `r2.dev` URL or public custom domain. The application deliberately has no public route for its objects.
2. Set a fresh production `PHOTO_LINK_SECRET` Worker secret containing 64 lowercase hex characters. Keep the local development key separate.
3. Apply migrations through `bun run db:migrate:remote`. Import verified assets with `photos:import --remote` and the explicit selection manifest, using the authenticated account configured for this repository. Remote import tooling is implemented but has not been exercised against production.
4. Have Claude implement the public gallery and owner UI against the API above. Review candidates, especially the 96 RAW sources without a Photos edit, then publish approved rows.
5. Release through the existing GitHub Actions pipeline after its checks pass. George's standing rule prohibits Codex from pushing; implementation does not authorise bypassing the repository's release path.
6. Verify private bucket isolation, actual production token expiry/revocation and cache exclusion, then measure mobile gallery performance. Local checks do not establish production configuration or gallery speed.

## Validation

Unit tests cover token tampering, expiry, purpose, scope, revocation, missing configuration, private caching, HEAD/range delivery, publication and metadata failures. HTTP tests use three synthetic images in isolated local R2/D1 fixtures. The fixture signing key is supplied only to the local test server. The preparation/import pipeline has also been exercised with the selected recovered photos, including an actual JPEG download checked against its prepared SHA-256.

See [ADR-0020](adr/0020-photo-downloads-use-revocable-signed-links.md) and the photo-printing workspace's local checklist for current outstanding review work.
