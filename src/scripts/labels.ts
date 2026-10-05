import type { TrackDetail } from "../lib/track";

// Wall labels open in place. Closed drawers stay hidden="until-found", so find-in-page can still reach them and a
// label's lazy snapshot isn't fetched until it opens. The pill's aria-expanded is the state (the .open class lags a
// frame behind for the animation).
const CLOSE_MS = 320;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
// Each label's pending hide, so a close still animating can't hide a label opened again since
const closing = new WeakMap<HTMLElement, number>();

function isOpen(item: HTMLElement) {
  return item.querySelector(".peek")?.getAttribute("aria-expanded") === "true";
}

// Queued a frame later for the animation; skipped if the label was closed again in the meantime
function showOpen(item: HTMLElement) {
  requestAnimationFrame(() => {
    if (isOpen(item)) item.classList.add("open");
  });
}

function setOpen(item: HTMLElement, open: boolean) {
  const pill = item.querySelector<HTMLButtonElement>(".peek");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!pill || !drawer) return;
  window.clearTimeout(closing.get(item));
  pill.setAttribute("aria-expanded", String(open));
  if (open) {
    drawer.removeAttribute("hidden");
    showOpen(item);
    return;
  }
  item.classList.remove("open");
  closing.set(
    item,
    window.setTimeout(() => {
      if (pill.getAttribute("aria-expanded") === "false") drawer.setAttribute("hidden", "until-found");
    }, reduced() ? 0 : CLOSE_MS),
  );
}

// The hover card's picture is named in data attributes until the first hover or focus, on fine pointers only (spec 4.1)
function loadCard(item: HTMLElement) {
  if (!finePointer()) return;
  for (const element of item.querySelectorAll<HTMLElement>(".hovercard [data-srcset], .hovercard [data-src]")) {
    if (element.dataset.srcset) element.setAttribute("srcset", element.dataset.srcset);
    if (element.dataset.src) element.setAttribute("src", element.dataset.src);
    delete element.dataset.srcset;
    delete element.dataset.src;
  }
  // Shown only from here on: without this script the card would be blank, and its "click for the label" untrue
  item.querySelector(".hovercard")?.classList.add("ready");
}

document.querySelectorAll<HTMLElement>(".line-item.labelled").forEach((item) => {
  const line = item.querySelector<HTMLElement>(".line");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  const pill = item.querySelector<HTMLButtonElement>(".peek");
  if (!line || !drawer || !pill) return;
  line.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) return; // links still navigate
    // The end of a text selection in this line, not a toggle. The pill always toggles: a click on a button leaves a
    // selection elsewhere on the page in place
    const selection = window.getSelection();
    if (!(event.target as HTMLElement).closest(".peek") && selection && !selection.isCollapsed && selection.containsNode(line, true)) return;
    setOpen(item, !isOpen(item));
    // Clicks only: a label revealed by find-in-page isn't counted
    if (isOpen(item) && item.dataset.slug) {
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "label_opened", properties: { slug: item.dataset.slug } } }));
    }
  });
  line.addEventListener("pointerenter", () => loadCard(item));
  pill.addEventListener("focus", () => loadCard(item));
  // A snapshot that won't load: the label shows just its tag (spec 4.1), and the hover card goes
  item.querySelector(".frame img")?.addEventListener("error", () => item.querySelector(".wall")?.classList.add("no-shot"));
  item.querySelector(".hovercard img")?.addEventListener("error", () => item.querySelector(".hovercard")?.remove());
  // Find-in-page revealed a closed label: reflect it as open at once, so the match shows straight away
  drawer.addEventListener("beforematch", () => {
    window.clearTimeout(closing.get(item));
    pill.setAttribute("aria-expanded", "true");
    item.classList.add("open");
  });
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen(item)) return;
    setOpen(item, false);
    pill.focus();
  });
});
