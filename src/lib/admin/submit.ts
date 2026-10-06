import { runAction, type ActionDeps, type ActionFailure } from "./actions";
import { purgeLogbook } from "./purge";

/** What the page does next: redirect to the saved section (303), or show the page again with this failure and status */
export type SubmitOutcome = { redirect: string } | { failure: ActionFailure; status: 422 | 500 };

const UNREADABLE: ActionFailure = { ok: false, section: null, form: "", errors: { form: "that form couldn't be read. try again." }, values: {} };
const UNEXPECTED: ActionFailure = { ok: false, section: null, form: "", errors: { form: "couldn't save that. try again." }, values: {} };

/**
 * Runs one admin post (spec 7): the write, then the purge so the logbook shows it. They run as one promise handed to
 * waitUntil, because a double tap cancels the first request and the runtime may cut a cancelled request's work off part
 * way through. That promise never rejects: a throw (a lost connection, two edits racing for one slug) is logged here, once,
 * and becomes a 500 the page can still render.
 */
export async function submitForm(
  form: FormData | null,
  deps: ActionDeps,
  cache: { invalidate(options: { tags: string[] }): Promise<unknown> },
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<SubmitOutcome> {
  if (!form) return { failure: UNREADABLE, status: 422 };
  const work = (async (): Promise<SubmitOutcome> => {
    try {
      const result = await runAction(form, deps);
      if (!result.ok) return { failure: result, status: 422 };
      const purged = await purgeLogbook(cache);
      return { redirect: `/admin/?saved=${result.section}${purged ? "" : "&later=1"}#${result.section}` };
    } catch (error) {
      console.error("admin: a save failed unexpectedly", error);
      return { failure: UNEXPECTED, status: 500 };
    }
  })();
  waitUntil(work);
  return work;
}
