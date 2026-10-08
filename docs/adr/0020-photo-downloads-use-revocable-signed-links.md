# ADR-0020: Photo downloads use revocable signed links

- Status: Accepted
- Date: 2026-10-08
- Source: George's direct instruction in the photo-printing conversation to use signed token links and implement the backend.

## Decision

Public responsive previews use the existing media delivery route. Full-resolution print JPEGs use a separate private R2 binding, `PHOTO_PRINTS`, and `/photos/downloads/<id>?token=…`. Photograph recipients do not authenticate with Cloudflare Access and do not need accounts or cookies.

The token is a purpose-specific HS256 JWT signed with a 32-byte Worker secret. It identifies a stored grant and is scoped to one photo or the published catalogue. Links last seven days by default and at most thirty days. The Worker checks the signature, issuer, audience, issue/expiry times, stored grant scope, revocation and publication before reading R2. Private responses cannot enter public caches. Removing a publication or revoking a grant takes effect on subsequent downloads.

Amended 2026-10-08 at George's direction: people get full-resolution access only through a catalogue-wide link, and one link opens every published photograph. The owner screen issues and revokes catalogue links only. A photo-scoped grant is used purely internally, as the short-lived file link the site gives Artelo for a paid print order (ADR-0021), never as a link a person receives. Ordering a print needs no link at all.

Owners can issue and revoke links with a CLI, without Access, or through new endpoints inside the website's existing owner-only administration. This does not introduce an Access application for photography recipients. The existing site administration's authentication is outside this change.

## Consequences

A link is a bearer credential: anyone holding it can use it while it remains valid. Revocation stops future requests, not files already downloaded or transfers already in progress. Multi-use tokens support resumable downloads. Token URLs are private, excluded from application logging and referrers; the Worker configuration also redacts query strings in observability.

The initial source selection is 462 matched photos. The 22 excluded lower-resolution images, five unmatched references and ten video positions do not enter the preparation/import pipeline. Private originals remain archived locally. New or changed prepared masters are imported as drafts and require a publication action after review.

## Delivery boundary

This change implements the catalogue, preparation/import tools, private file delivery and owner APIs. Claude owns the public gallery and owner UI under George's standing rule. Production release follows the existing GitHub Actions checks and deployment path.
