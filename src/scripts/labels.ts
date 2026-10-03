export {};

// Wall labels open in place. Closed drawers stay hidden="until-found" so find-in-page can still reach them.
// The pill's aria-expanded is the state (the .open class lags a frame behind for the animation).
const CLOSE_MS = 320;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function setOpen(item: HTMLElement, open: boolean) {
  const pill = item.querySelector<HTMLButtonElement>(".peek");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!pill || !drawer) return;
  pill.setAttribute("aria-expanded", String(open));
  if (open) {
    drawer.removeAttribute("hidden");
    requestAnimationFrame(() => item.classList.add("open"));
    return;
  }
  item.classList.remove("open");
  window.setTimeout(() => {
    if (pill.getAttribute("aria-expanded") === "false") drawer.setAttribute("hidden", "until-found");
  }, reduced() ? 0 : CLOSE_MS);
}

const isOpen = (item: HTMLElement) => item.querySelector(".peek")?.getAttribute("aria-expanded") === "true";

document.querySelectorAll<HTMLElement>(".line-item.labelled").forEach((item) => {
  const line = item.querySelector<HTMLElement>(".line");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!line || !drawer) return;
  line.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) return; // links still navigate
    setOpen(item, !isOpen(item));
  });
  // Find-in-page revealed a closed label: reflect it as open
  drawer.addEventListener("beforematch", () => {
    item.querySelector(".peek")?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => item.classList.add("open"));
  });
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen(item)) return;
    setOpen(item, false);
    item.querySelector<HTMLButtonElement>(".peek")?.focus();
  });
});
