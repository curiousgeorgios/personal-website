import { printConfig } from "../prints/config";
import { mailHtml } from "../prints/mail";
import type { PhotoAccessDeps } from "./access";

export function photoAccessDeps(env: Cloudflare.Env): PhotoAccessDeps {
  return {
    db: env.DB,
    secret: env.PHOTO_LINK_SECRET,
    now: () => Math.floor(Date.now() / 1000),
    client(request) {
      let client = request.headers.get("cf-connecting-ip") ?? "unknown";
      if (__TEST_HOOKS__) {
        const fixture = request.headers.get("X-Test-Client");
        if (fixture) client = fixture;
      }
      return client;
    },
    async sendCode(email, code) {
      const config = printConfig(env);
      const text = `your sign-in code for full-resolution photo downloads is ${code}.\n\nthis code expires in 10 minutes and works once. signing in keeps this browser signed in for 14 days.\n\nif you did not request this code, ignore this email. never share the code.`;
      const message = { from: { email: config.fromEmail, name: config.sellerName }, to: email, subject: "your photo download sign-in code", text, html: mailHtml(text) };
      try {
        if (config.emailSink) {
          const response = await fetch(config.emailSink, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) });
          if (!response.ok) throw new Error("Email sink unavailable");
        } else await env.EMAIL.send(message);
        return true;
      } catch {
        console.error("photos: sign-in email unavailable");
        return false;
      }
    },
  };
}
