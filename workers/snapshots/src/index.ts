import puppeteer from "@cloudflare/puppeteer";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { SnapshotsEnv } from "./env";
import { reshootOne, runAll, type RunDeps } from "./run";

// The snapshots Worker (spec 9): the nightly run on its cron, and "re-shoot now" over RPC for the admin page
export default class Snapshots extends WorkerEntrypoint<SnapshotsEnv> {
  async scheduled(): Promise<void> {
    const outcomes = await runAll(this.deps());
    console.log("snapshots: nightly run", JSON.stringify(outcomes));
  }

  /** Captures one line now (the admin's "re-shoot now"); "gone" when it has no page to snapshot */
  async reshoot(id: number) {
    try {
      return await reshootOne(this.deps(), id);
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

  private deps(): RunDeps {
    const { DB, MEDIA, IMAGES, BROWSER } = this.env;
    // @cloudflare/puppeteer's Browser and Page provide the slice capture() uses, so no cast is needed
    return { db: DB, media: MEDIA, images: IMAGES, launch: () => puppeteer.launch(BROWSER) };
  }
}
