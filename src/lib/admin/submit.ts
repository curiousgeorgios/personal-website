import { runAction, type ActionDeps, type ActionFailure, type AdminSection, type IssuedLink } from "./actions";
import { purgeTags } from "./purge";

/** What the page does next: redirect to the saved section (303), show a link just issued (200) or show the page again with this failure and status */
export type SubmitOutcome = { redirect: string } | { issued: IssuedLink } | { failure: ActionFailure; status: 422 | 500 };

const UNREADABLE: ActionFailure = { ok: false, section: null, form: "", errors: { form: "that form couldn't be read. try again." }, values: {} };
const UNEXPECTED: ActionFailure = { ok: false, section: null, form: "", errors: { form: "couldn't save that. try again." }, values: {} };

/** The cache tags each section's saves purge (spec 6.1): photographs change the gallery and, through its line, the home page */
const PURGES: Record<AdminSection, string[]> = {
  now: ["logbook"],
  before: ["logbook"],
  log: ["logbook"],
  lately: ["logbook"],
  records: ["logbook"],
  snapshots: ["logbook"],
  photographs: ["photos", "logbook"],
  links: [],
  // The buffer is read by the next quote and retry now changes no page: nothing cached shows either (spec 20)
  orders: [],
};

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
      // The link exists only in this response, so it isn't a redirect (spec 6.3); links purge nothing
      if (result.issued) return { issued: result.issued };
      const tags = [...PURGES[result.section], ...(result.purge ?? [])];
      const purged = tags.length === 0 || (await purgeTags(cache, tags));
      return { redirect: `/admin/?saved=${result.section}${result.note ? `&note=${result.note}` : ""}${purged ? "" : "&later=1"}#${result.section}` };
    } catch (error) {
      console.error("admin: a save failed unexpectedly", error);
      return { failure: UNEXPECTED, status: 500 };
    }
  })();
  waitUntil(work);
  return work;
}
