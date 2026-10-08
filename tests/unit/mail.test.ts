import { afterEach, describe, expect, test, vi } from "vitest";
import { mailHtml, sendDueMail, sendMail, shippedText } from "../../src/lib/prints/mail";
import { orderLines } from "../../src/lib/prints/store";
import { viewKey } from "../../src/lib/prints/view-key";
import { captureLogs, dumpDb, fakeFetch, insertOrder, json, NOW, printDb, testConfig, testDeps, VIEW_SECRET, type Handler } from "./prints-fakes";

const SHIPMENTS = JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]);
const binding = () => ({ send: vi.fn(async () => ({ messageId: "m" })) });
const stripeSession = (email: string | null): Handler => () => json({ id: "cs", customer_details: { email } });
const mailDeps = async (handlers: Record<string, Handler> = {}, over = {}) => {
  const db = await printDb();
  const email = binding();
  const fake = fakeFetch(handlers);
  return { db, email, fake, deps: testDeps(db, { email: email as unknown as SendEmail, fetch: fake.fetch, ...over }) };
};

afterEach(() => vi.restoreAllMocks());

describe("sending", () => {
  test("through the binding, from george vlachos at prints@, replying to hello@, with text and plain html", async () => {
    const { email, deps } = await mailDeps();
    expect(await sendMail(deps, { to: "buyer@example.com", subject: "hi", text: "one <two>\n\nthree" }, "a test email")).toBe(true);
    expect(email.send).toHaveBeenCalledWith({
      from: { email: "prints@curiousgeorge.dev", name: "george vlachos" }, to: "buyer@example.com", replyTo: "hello@curiousgeorge.dev",
      subject: "hi", text: "one <two>\n\nthree", html: "<p>one &lt;two&gt;</p>\n<p>three</p>",
    });
    expect(mailHtml("a\nb")).toBe("<p>a<br>b</p>");
  });

  test("a test build posts to the sink instead; a failure is logged with what it was about and nothing else", async () => {
    const logs = captureLogs();
    const sink = vi.fn(async (request: Request) => {
      await request.json();
      return new Response(null, { status: 204 });
    });
    const { email, deps } = await mailDeps({ "POST http://127.0.0.1:4401/__mail": sink }, { config: testConfig({ emailSink: "http://127.0.0.1:4401/__mail" }) });
    expect(await sendMail(deps, { to: "buyer@example.com", subject: "s", text: "t" }, "a test email")).toBe(true);
    expect(email.send).not.toHaveBeenCalled();
    expect(sink).toHaveBeenCalledTimes(1);
    const broken = testDeps(deps.db, { email: { send: vi.fn(async () => { throw new Error("rejected buyer@example.com"); }) } as unknown as SendEmail });
    expect(await sendMail(broken, { to: "buyer@example.com", subject: "s", text: "t" }, "shipped email for order x")).toBe(false);
    expect(logs()).toContain("prints: couldn't send the shipped email for order x");
    expect(logs()).not.toContain("buyer@example.com");
  });
});

describe("due mail", () => {
  test("an order needing attention emails george once, with its reason and the admin's link", async () => {
    const { db, email, deps } = await mailDeps();
    const id = await insertOrder(db, { status: "needs_attention", attention_reason: "artelo refused the order: unknown size" });
    await sendDueMail(deps);
    await sendDueMail(deps);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${id} needs attention`, text: "artelo refused the order: unknown size\n\nhttps://curiousgeorge.dev/admin/#orders" }));
    expect(await db.prepare("SELECT attention_notified_at FROM print_orders").first("attention_notified_at")).toBe(NOW);
  });

  test("a shipped order emails the buyer once, from the session's email, with every print, its tracking and its page", async () => {
    const logs = captureLogs();
    const { db, email, deps } = await mailDeps({ "GET https://stripe.test/v1/checkout/sessions/cs_test_ship": stripeSession("buyer@example.com") });
    const id = await insertOrder(db, { status: "shipped", stripe_session_id: "cs_test_ship", shipments: SHIPMENTS });
    await sendDueMail(deps);
    await sendDueMail(deps);
    expect(email.send).toHaveBeenCalledTimes(1);
    const page = `https://curiousgeorge.dev/prints/${id}?key=${await viewKey(VIEW_SECRET, id)}`;
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "buyer@example.com", subject: "your prints are on their way",
      text: `hi, your prints have left the printer:\n\nphoto 1 of 2 from 14.06.26 · medium · oak frame\nphoto 2 of 2 from 14.06.26 · small · unframed\n\ntracking: ups 1Z999AA10123456784 https://www.ups.com/track?tracknum=1Z999AA10123456784\n\nyou can check on them here: ${page}. thanks for buying them. - george`,
    }));
    expect(await dumpDb(db)).not.toContain("buyer@example.com");
    expect(logs()).not.toContain("buyer@example.com");
  });

  test("one print reads in the singular", async () => {
    const { db } = await mailDeps();
    const id = await insertOrder(db, { status: "shipped" }, [["fixture-01", "small", "oak", 1]]);
    const lines = (await orderLines(db, [id])).get(id)!;
    expect(shippedText(lines, [], "https://x/page")).toBe('hi, your print has left the printer:\n\n"a test photograph" · small · oak frame\n\nyou can check on it here: https://x/page. thanks for buying it. - george');
  });

  test("a failed send releases the claim, so the next cron run tries again until it goes", async () => {
    captureLogs();
    const { db, deps } = await mailDeps({ "GET https://stripe.test/v1/checkout/sessions/cs_test_retry": stripeSession("buyer@example.com") });
    await insertOrder(db, { status: "shipped", stripe_session_id: "cs_test_retry", shipments: SHIPMENTS });
    const failing = { send: vi.fn(async () => { throw new Error("down"); }) };
    await sendDueMail(testDeps(db, { email: failing as unknown as SendEmail, fetch: deps.fetch }));
    expect(await db.prepare("SELECT shipped_email_at FROM print_orders").first("shipped_email_at")).toBeNull();
    await sendDueMail(deps);
    expect(await db.prepare("SELECT shipped_email_at FROM print_orders").first("shipped_email_at")).toBe(NOW);
  });

  test("no email from stripe, or stripe unreachable, sends nothing and leaves it due", async () => {
    captureLogs();
    for (const handler of [stripeSession(null), () => json({}, 503)] as Handler[]) {
      const { db, email, deps } = await mailDeps({ "GET https://stripe.test/v1/checkout/sessions/cs_test_none": handler });
      await insertOrder(db, { status: "shipped", stripe_session_id: "cs_test_none" });
      await sendDueMail(deps);
      expect(email.send).not.toHaveBeenCalled();
      expect(await db.prepare("SELECT shipped_email_at FROM print_orders").first("shipped_email_at")).toBeNull();
    }
  });
});

describe("george's notes", () => {
  test("a cancellation or a missed webhook is due until it goes: a failed send is given back and the cron sends it", async () => {
    captureLogs();
    const { db, deps } = await mailDeps();
    const cancelled = await insertOrder(db, { id: "01k6x00000000000000000000a", status: "cancelled", admin_notified_at: 0 });
    const reconciled = await insertOrder(db, { id: "01k6x00000000000000000000b", status: "paid", admin_notified_at: 0 });
    const failing = { send: vi.fn(async () => { throw new Error("down"); }) };
    await sendDueMail(testDeps(db, { email: failing as unknown as SendEmail }));
    expect((await db.prepare("SELECT admin_notified_at FROM print_orders ORDER BY id").all()).results).toEqual([{ admin_notified_at: 0 }, { admin_notified_at: 0 }]);
    await sendDueMail(deps);
    await sendDueMail(deps);
    expect(deps.email!.send).toHaveBeenCalledTimes(2);
    expect(deps.email!.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${cancelled} was cancelled by artelo`, text: `artelo cancelled order ${cancelled}. refund it in stripe.` }));
    expect(deps.email!.send).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${reconciled}: stripe's webhook never arrived`, text: `print order ${reconciled} was paid but stripe's webhook never arrived. check the webhook in stripe.` }));
    expect((await db.prepare("SELECT admin_notified_at FROM print_orders ORDER BY id").all()).results).toEqual([{ admin_notified_at: NOW }, { admin_notified_at: NOW }]);
  });
});

test("order lines name each photo, keep a hidden photo's name and leave out its thumbnail", async () => {
  const { db } = await mailDeps();
  const id = await insertOrder(db);
  await db.prepare("UPDATE photos SET published = 0 WHERE id = 'fixture-b-02'").run();
  const [first, second] = (await orderLines(db, [id])).get(id)!;
  // The visible photo's name now counts only what is published; the hidden one counts itself ("Decisions")
  expect(first).toMatchObject({ line: 1, photoId: "fixture-b-01", tier: "medium", size: "x12x18", frame: "oak", quantity: 1, unitAmount: 17900, name: "photo 1 of 1 from 14.06.26" });
  expect(first.thumb?.url).toMatch(/240\.webp$/);
  expect(second).toMatchObject({ name: "photo 2 of 2 from 14.06.26", thumb: null });
});
