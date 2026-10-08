import { expect, test, vi } from "vitest";
import { purgeTags } from "../../src/lib/admin/purge";

test("purges the given tags and says it did", async () => {
  const invalidate = vi.fn(async () => {});
  expect(await purgeTags({ invalidate }, ["photos", "logbook"])).toBe(true);
  expect(invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook"] });
});

test("a purge that fails is reported, not thrown (local runs have no purge)", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await purgeTags({ invalidate: async () => Promise.reject(new TypeError("cache.purge is not a function")) }, ["logbook"])).toBe(false);
  expect(error).toHaveBeenCalledWith("admin: couldn't purge the cached pages tagged logbook", "cache.purge is not a function");
  error.mockRestore();
});
