// The analytics events (spec 10). Scripts announce them as a DOM event, "logbook:track", which the beacon
// (src/scripts/beacon.ts) sends on. Only types live here: a shared runtime module would become a hashed chunk that a
// cached page depends on, and the label script, the deck runner and the scene must stay independent of the beacon.

export type TrackEvent = "$pageview" | "label_opened" | "record_played" | "scratch_found";
export type TrackProperties = Record<string, string | number>;

export interface TrackDetail {
  event: Exclude<TrackEvent, "$pageview">;
  properties?: TrackProperties;
}

declare global {
  interface DocumentEventMap {
    "logbook:track": CustomEvent<TrackDetail>;
  }
}
