import { expect, test, vi } from "vitest";
import { purgeLogbook } from "../../src/lib/admin/purge";

test("purges the logbook tag and says it did", async () => {
  const invalidate = vi.fn(async () => {});
  expect(await purgeLogbook({ invalidate })).toBe(true);
  expect(invalidate).toHaveBeenCalledWith({ tags: ["logbook"] });
});

test("a purge that fails is reported, not thrown (local runs have no purge)", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await purgeLogbook({ invalidate: async () => Promise.reject(new TypeError("cache.purge is not a function")) })).toBe(false);
  expect(error).toHaveBeenCalled();
  error.mockRestore();
});
