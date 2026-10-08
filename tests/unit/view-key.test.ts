import { expect, test } from "vitest";
import { orderPageUrl, viewKey, viewKeyMatches } from "../../src/lib/prints/view-key";
import { testConfig, VIEW_SECRET } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";

test("the view key is derived from the secret and the order, the same every time and never stored", async () => {
  const key = await viewKey(VIEW_SECRET, ORDER);
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await viewKey(VIEW_SECRET, ORDER)).toBe(key);
  expect(await viewKey(VIEW_SECRET, "01k6x00000000000000000000b")).not.toBe(key);
  expect(await orderPageUrl(testConfig(), ORDER)).toBe(`https://curiousgeorge.dev/prints/${ORDER}?key=${key}`);
});

test("only the right key matches; anything else, or no secret, doesn't", async () => {
  const key = await viewKey(VIEW_SECRET, ORDER);
  expect(await viewKeyMatches(VIEW_SECRET, ORDER, key)).toBe(true);
  expect(await viewKeyMatches(VIEW_SECRET, "01k6x00000000000000000000b", key)).toBe(false);
  expect(await viewKeyMatches("3".repeat(64), ORDER, key)).toBe(false);
  expect(await viewKeyMatches("", ORDER, key)).toBe(false);
  for (const wrong of [null, "", "abc", `${key}x`, key.slice(0, -1), "!".repeat(43)]) expect(await viewKeyMatches(VIEW_SECRET, ORDER, wrong)).toBe(false);
});
