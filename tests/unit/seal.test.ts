import { describe, expect, test } from "vitest";
import { b64url, fromB64url, openQuote, sameQuote, sealQuote, type QuotePayload } from "../../src/lib/prints/seal";
import { ADDRESS, NOW, VIEW_SECRET } from "./prints-fakes";

const payload = (over: Partial<QuotePayload> = {}): QuotePayload => ({
  items: "fixture-b-01:medium:oak,fixture-b-02:small:unframed", address: ADDRESS, printTotal: 23800, deliveryAmount: 4900, freightCents: 3000, taxes: [],
  buffer: 0.08, rate: 1.5, expires: NOW + 1800, ...over,
});
const tamper = (token: string, part: 0 | 1) => {
  const parts = token.split(".");
  const bytes = fromB64url(parts[part])!;
  bytes[0] ^= 1;
  parts[part] = b64url(bytes);
  return parts.join(".");
};

describe("the sealed quote", () => {
  test("opens to exactly what was sealed until it runs out", async () => {
    const token = await sealQuote(VIEW_SECRET, payload());
    expect(await openQuote(VIEW_SECRET, token, NOW)).toEqual(payload());
    expect(await openQuote(VIEW_SECRET, token, NOW + 1799)).toEqual(payload());
    expect(await openQuote(VIEW_SECRET, token, NOW + 1800)).toBeNull();
  });

  test("a changed payload, signature, secret or shape is refused", async () => {
    const token = await sealQuote(VIEW_SECRET, payload());
    expect(await openQuote(VIEW_SECRET, tamper(token, 0), NOW)).toBeNull();
    expect(await openQuote(VIEW_SECRET, tamper(token, 1), NOW)).toBeNull();
    expect(await openQuote("3".repeat(64), token, NOW)).toBeNull();
    // A cheaper delivery sealed under another key, or glued to this signature, opens to nothing
    const cheaper = await sealQuote("3".repeat(64), payload({ deliveryAmount: 100 }));
    expect(await openQuote(VIEW_SECRET, `${cheaper.split(".")[0]}.${token.split(".")[1]}`, NOW)).toBeNull();
    for (const value of ["", "abc", `${token}.x`, "!!.??", "a".repeat(9000)]) expect(await openQuote(VIEW_SECRET, value, NOW)).toBeNull();
  });

  test("the same items and every address field exactly, or it isn't the same quote", () => {
    const sealed = payload();
    expect(sameQuote(sealed, sealed.items, { ...ADDRESS })).toBe(true);
    expect(sameQuote(sealed, "fixture-b-01:medium:oak", ADDRESS)).toBe(false);
    for (const field of Object.keys(ADDRESS) as (keyof typeof ADDRESS)[]) expect(sameQuote(sealed, sealed.items, { ...ADDRESS, [field]: `${ADDRESS[field]}x` })).toBe(false);
  });

  test("an address in another script, with markup and punctuation, round-trips (review focus 1)", async () => {
    const address = { ...ADDRESS, name: "Zoë O'Brien & Sons", line1: "東京都渋谷区 1-2-3", line2: "<b>unit</b> 3", country: "JP" };
    const opened = await openQuote(VIEW_SECRET, await sealQuote(VIEW_SECRET, payload({ address })), NOW);
    expect(opened?.address).toEqual(address);
    expect(sameQuote(opened!, opened!.items, address)).toBe(true);
  });
});
