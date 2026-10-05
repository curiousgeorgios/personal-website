/** The snapshots Worker's bindings (workers/snapshots/wrangler.jsonc) */
export interface SnapshotsEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  BROWSER: Fetcher;
}
