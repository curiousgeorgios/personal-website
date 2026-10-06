export {};

const CLOSE_MS = 300;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const log = document.querySelector<HTMLElement>(".log");
const button = log?.querySelector<HTMLButtonElement>(".more");
const older = log?.querySelector<HTMLElement>(".older");
let closing = 0;

function setOpen(open: boolean) {
  if (!log || !button || !older) return;
  window.clearTimeout(closing);
  button.setAttribute("aria-expanded", String(open));
  const label = button.querySelector(".lbl");
  if (label) label.textContent = open ? "fewer entries" : "older entries";
  if (open) {
    older.removeAttribute("hidden");
    // Queued a frame later for the animation; skipped if the log was closed again in the meantime
    requestAnimationFrame(() => { if (button.getAttribute("aria-expanded") === "true") log.classList.add("open"); });
    return;
  }
  log.classList.remove("open");
  closing = window.setTimeout(() => { if (button.getAttribute("aria-expanded") === "false") older.setAttribute("hidden", "until-found"); }, reduced() ? 0 : CLOSE_MS);
}

button?.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
older?.addEventListener("beforematch", () => setOpen(true));
