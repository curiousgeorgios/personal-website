import type { TrackDetail } from "../lib/track";

export {};

// Wall labels open in place. Closed drawers stay hidden="until-found" so find-in-page can still reach them.
// The pill's aria-expanded is the state (the .open class lags a frame behind for the animation).
const CLOSE_MS = 320;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  pill.setAttribute("aria-expanded", String(open));
  if (open) {
    drawer.removeAttribute("hidden");
    showOpen(item);
    return;
  }
  item.classList.remove("open");
  window.setTimeout(() => {
    if (pill.getAttribute("aria-expanded") === "false") drawer.setAttribute("hidden", "until-found");
  }, reduced() ? 0 : CLOSE_MS);
}

document.querySelectorAll<HTMLElement>(".line-item.labelled").forEach((item) => {
  const line = item.querySelector<HTMLElement>(".line");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!line || !drawer) return;
  line.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) return; // links still navigate
    setOpen(item, !isOpen(item));
    // Clicks only: a label revealed by find-in-page isn't counted
    if (isOpen(item) && item.dataset.slug) {
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "label_opened", properties: { slug: item.dataset.slug } } }));
    }
  });
  // Find-in-page revealed a closed label: reflect it as open
  drawer.addEventListener("beforematch", () => {
    item.querySelector(".peek")?.setAttribute("aria-expanded", "true");
    showOpen(item);
  });
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen(item)) return;
    setOpen(item, false);
    item.querySelector<HTMLButtonElement>(".peek")?.focus();
  });
});
