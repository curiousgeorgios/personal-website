import { afterEach, expect, test, vi } from "vitest";

// The Worker's entrypoint without the Workers runtime: a plain base class, and a puppeteer that's never reached
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(async () => {
      throw new Error("no browser in unit tests");
    }),
  },
}));

const { default: Snapshots } = await import("../../workers/snapshots/src/index");

// A database that can't be read, so the run fails as a whole before any capture
const brokenDb = {
  prepare: () => {
    throw new Error("D1_ERROR: no such table: items");
  },
} as unknown as D1Database;
const worker = () => new Snapshots({} as ExecutionContext, { DB: brokenDb, MEDIA: {} as R2Bucket, IMAGES: {} as ImagesBinding, BROWSER: {} as Fetcher });

afterEach(() => vi.restoreAllMocks());

test("a nightly run that fails as a whole is logged with its error, and still fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(worker().scheduled()).rejects.toThrow("no such table");
  expect(error).toHaveBeenCalledWith("snapshots: nightly run failed:", expect.any(Error));
});

test("a re-shoot that fails is logged with its error, and the admin still gets it", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(worker().reshoot(7)).rejects.toThrow("no such table");
  expect(error).toHaveBeenCalledWith("snapshots: re-shoot of line 7 failed:", expect.any(Error));
});
