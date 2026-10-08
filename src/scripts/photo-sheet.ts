import { frameView, type FrameView } from "../lib/photos/gallery";
import type { Entry } from "../lib/photos/store";
import { formatLogDate } from "../lib/text";

// Older entries, appended as the visitor nears the end of the list (spec 3.4). Without this script, or once a batch
// fails, "older entries" is a plain link. One fetch at a time; focus never moves; the URL never changes.

type ApiEntry = Omit<Entry, "publishedAt">;

/** The API's batch: larger than a server-rendered page, because the visitor is already scrolling */
const BATCH = 4;

function start(more: HTMLAnchorElement, list: HTMLOListElement, entryTemplate: HTMLTemplateElement, frameTemplate: HTMLTemplateElement) {
  const label = more.querySelector(".lbl")!;
  let busy = false;

  const frame = (view: FrameView) => {
    const node = frameTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    node.querySelector("a")!.href = view.href;
    // Filled as Frame.astro renders it: the two phone sources (240s only), then the AVIF, then the img. Sizes goes
    // before srcset and src, so the browser never picks a candidate for the wrong width
    const [phoneAvif, phoneWebp, avif] = node.querySelectorAll("source");
    phoneAvif.sizes = phoneWebp.sizes = avif.sizes = view.sizes;
    phoneAvif.srcset = view.phoneAvif;
    phoneWebp.srcset = view.phoneWebp;
    avif.srcset = view.avif;
    const img = node.querySelector("img")!;
    img.width = view.width;
    img.height = view.height;
    img.alt = view.alt;
    img.sizes = view.sizes;
    img.srcset = view.webp;
    img.src = view.src;
    node.querySelector(".frame-no")!.textContent = view.number;
    return node;
  };

  const entry = (data: ApiEntry) => {
    const node = entryTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    node.id = `post-${data.collection}`;
    const time = node.querySelector("time")!;
    time.dateTime = data.date;
    time.textContent = formatLogDate(data.date, "day");
    node.querySelector(".entry-place")!.textContent = data.place ? ` · ${data.place}` : "";
    const sheet = node.querySelector(".sheet")!;
    data.photos.forEach((photo, index) => {
      const view = frameView(photo, index, data.photos.length);
      if (view) sheet.appendChild(frame(view));
    });
    return node;
  };

  const settle = () => {
    label.textContent = "older entries";
    more.removeAttribute("aria-disabled");
    busy = false;
  };

  const load = async () => {
    if (busy) return;
    busy = true;
    label.textContent = "loading older entries…";
    more.setAttribute("aria-disabled", "true");
    try {
      const response = await fetch(`/api/photos?by=entry&before=${more.dataset.next}&limit=${BATCH}`);
      if (!response.ok) throw new Error(`the gallery answered ${response.status}`);
      const page = (await response.json()) as { entries: ApiEntry[]; next: number | null };
      // A cursor that doesn't move would fetch the same page for ever, so it counts as a failure
      if (page.next !== null && String(page.next) === more.dataset.next) throw new Error("the gallery's cursor didn't advance");
      // Built whole, then appended once: a bad entry halfway leaves the list as it was, so the plain link repeats nothing
      const batch = document.createDocumentFragment();
      for (const data of page.entries) batch.appendChild(entry(data));
      list.appendChild(batch);
      if (page.next === null) {
        observer.disconnect();
        const end = document.createElement("p");
        end.className = "more-end";
        end.textContent = "that's every entry.";
        // Focus never moves (spec 3.4): if the link had it, the line that takes its place keeps it
        const focused = document.activeElement === more;
        if (focused) end.tabIndex = -1;
        more.replaceWith(end);
        if (focused) end.focus({ preventScroll: true });
        return;
      }
      more.href = `/photos?before=${page.next}`;
      more.dataset.next = String(page.next);
      settle();
      // A short batch can leave the link still near the end; the observer only calls back on a change, so ask again
      observer.unobserve(more);
      observer.observe(more);
    } catch {
      // Back to a plain link a click follows, and no more fetching
      observer.disconnect();
      settle();
    }
  };

  const observer = new IntersectionObserver((records) => {
    if (records.some((record) => record.isIntersecting)) void load();
  }, { rootMargin: "0px 0px 800px 0px" });
  // A click while a batch loads would fetch the same entries a second way
  more.addEventListener("click", (event) => {
    if (busy) event.preventDefault();
  });

  // Watching starts with the visitor's first sign of scrolling, never on load: a two-entry page can already have the link
  // inside the 800px margin, and observing then would fetch a batch nobody asked for. A scroll, wheel or touch move is
  // one; so is a key that scrolls (not Tab, Shift or a chord such as Cmd+F) and focus arriving on the link itself.
  // Wheel, touch and keys count because a page too short to scroll fires no scroll event
  const SCROLLING_KEYS = new Set(["PageDown", "PageUp", "End", "Home", " ", "ArrowDown", "ArrowUp"]);
  const events = ["scroll", "wheel", "touchmove", "keydown"] as const;
  const begin = (event: Event) => {
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.ctrlKey || key.metaKey || key.altKey || !SCROLLING_KEYS.has(key.key)) return;
    }
    for (const type of events) removeEventListener(type, begin);
    more.removeEventListener("focusin", begin);
    observer.observe(more);
  };
  for (const type of events) addEventListener(type, begin, { passive: true });
  more.addEventListener("focusin", begin);
}

const more = document.querySelector<HTMLAnchorElement>("a.more[data-next]");
const list = document.querySelector<HTMLOListElement>("ol.entries");
const entryTemplate = document.querySelector<HTMLTemplateElement>("#entry-template");
const frameTemplate = document.querySelector<HTMLTemplateElement>("#frame-template");
if (more && list && entryTemplate && frameTemplate && "IntersectionObserver" in window) start(more, list, entryTemplate, frameTemplate);
