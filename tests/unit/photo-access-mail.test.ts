import { afterEach, expect, test, vi } from "vitest";
import { photoAccessDeps } from "../../src/lib/photos/access-env";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const environment = (send: ReturnType<typeof vi.fn>) => ({
  PRINT_FROM_EMAIL: "prints@curiousgeorge.dev", PRINT_SELLER_NAME: "george vlachos", EMAIL: { send },
  EMAIL_SINK: "https://sink.example.test",
}) as unknown as Cloudflare.Env;

test("production OTP mail uses the existing binding, with plain text and HTML, and ignores test sinks", async () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const send = vi.fn(async (_message: { text: string }) => ({ messageId: "fixture" }));
  const fetcher = vi.spyOn(globalThis, "fetch");
  expect(await photoAccessDeps(environment(send)).sendCode("recipient@example.test", "012345")).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]).toEqual([{
    from: { email: "prints@curiousgeorge.dev", name: "george vlachos" }, to: "recipient@example.test",
    subject: "your photo download sign-in code", text: expect.stringContaining("012345"), html: expect.stringContaining("012345"),
  }]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(send.mock.calls[0][0].text).toContain("14 days");
});

test("delivery exceptions return failure and log only a fixed line", async () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const send = vi.fn(async () => { throw new Error("recipient@example.test private-code-012345"); });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await photoAccessDeps(environment(send)).sendCode("recipient@example.test", "012345")).toBe(false);
  expect(log.mock.calls).toEqual([["photos: sign-in email unavailable"]]);
});

test("test builds send synthetic mail to the local sink and refuse unsuccessful delivery", async () => {
  vi.stubGlobal("__TEST_HOOKS__", true);
  const send = vi.fn();
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 })).mockResolvedValueOnce(new Response("", { status: 503 }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const deps = photoAccessDeps(environment(send));
  expect(await deps.sendCode("recipient@example.test", "012345")).toBe(true);
  expect(await deps.sendCode("recipient@example.test", "012345")).toBe(false);
  expect(fetcher.mock.calls[0][0]).toBe("https://sink.example.test");
  expect(send).not.toHaveBeenCalled();
  expect(log.mock.calls).toEqual([["photos: sign-in email unavailable"]]);
});
