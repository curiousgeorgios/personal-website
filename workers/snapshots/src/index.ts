import puppeteer from "@cloudflare/puppeteer";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { SnapshotsEnv } from "./env";
import { reshootOne, runAll, type RunDeps } from "./run";

// Outside the class: every method on an entrypoint is callable over RPC, whatever TypeScript calls private
function depsOf(env: SnapshotsEnv): RunDeps {
  const { DB, MEDIA, IMAGES, BROWSER } = env;
  // @cloudflare/puppeteer's Browser and Page provide the slice capture() uses, so no cast is needed
  // Browser Rendering closes a browser idle for 60s, and encoding and storing a line can take that long
  return { db: DB, media: MEDIA, images: IMAGES, launch: () => puppeteer.launch(BROWSER, { keep_alive: 600_000 }) };
}

// The snapshots Worker (spec 9): the nightly run on its cron, and "re-shoot now" over RPC for the admin page
export default class Snapshots extends WorkerEntrypoint<SnapshotsEnv> {
  async scheduled(): Promise<void> {
    try {
      const outcomes = await runAll(depsOf(this.env));
      console.log("snapshots: nightly run", JSON.stringify(outcomes));
    } catch (error) {
      // A run that fails as a whole (Browser Rendering down, the database unreadable) is logged here with its stack
      console.error("snapshots: nightly run failed:", error);
      throw error;
    }
  }

  /** Captures one line now (the admin's "re-shoot now"); "gone" when it has no page to snapshot */
  async reshoot(id: number) {
    try {
      return await reshootOne(depsOf(this.env), id);
    } catch (error) {
      // reshootOne doesn't log: this puts the error and its stack in this Worker's logs, and the admin still gets it
      console.error(`snapshots: re-shoot of line ${id} failed:`, error);
      throw error;
    }
  }

  // No public route: the Worker is reached only by its cron and the service binding
  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}
