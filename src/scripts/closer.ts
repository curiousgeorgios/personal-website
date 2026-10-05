// The closer look (spec 4.1): a framed snapshot grows from its frame to fit the viewport over a paper veil (FLIP,
// 420ms ease-out-quint), and goes back into its frame (300ms ease-out) on a click, the close button or Esc. The dialog
// is modal, so focus moves into it, and returns to the frame. Nothing moves under reduced motion.
const dialog = document.querySelector<HTMLDialogElement>("dialog.closer");
const big = dialog?.querySelector("img");
const source = dialog?.querySelector("source");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// The transform that puts `to` where `from` is
const flip = (from: DOMRect, to: DOMRect) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
// The image's box with no transform, for a FLIP to aim at. A grow still running when it's closed is put back as it was,
// with no frame painted between, so the close starts from where the image has got to
function restBox(img: HTMLElement) {
  const now = getComputedStyle(img).transform;
  img.style.transition = "none";
  img.style.transform = "none";
  const box = img.getBoundingClientRect();
  img.style.transform = now;
  img.getBoundingClientRect(); // settles the style, so the transition that follows starts from `now`
  return box;
}
let frame: HTMLAnchorElement | null = null; // the frame whose snapshot is in the dialog
let pending: HTMLAnchorElement | null = null; // the frame whose big file is still loading: one open at a time
let closing = false;
let timer = 0;

function empty() {
  big?.removeAttribute("src");
  source?.removeAttribute("srcset");
}

async function open(link: HTMLAnchorElement) {
  if (!dialog || !big || !source || dialog.open || pending) return;
  const shot = link.querySelector("img");
  if (!shot) return;
  pending = link;
  link.setAttribute("aria-busy", "true"); // the pointer says so too (notebook.css)
  source.srcset = link.dataset.closerAvif ?? "";
  big.src = link.dataset.closerWebp ?? "";
  big.alt = shot.alt;
  dialog.setAttribute("aria-label", `closer look: ${shot.alt}`);
  await big.decode().catch(() => {}); // it rejects when the file fails to load or to decode; naturalWidth says which
  if (big.naturalWidth === 0 && shot.currentSrc) {
    // No big file: grow from the frame's own picture, which is already here, rather than from a broken-image box
    source.removeAttribute("srcset");
    big.src = shot.currentSrc;
    await big.decode().catch(() => {});
  }
  pending = null;
  link.removeAttribute("aria-busy");
  // The label may have been closed while the file loaded (its pill's aria-expanded is the state), and nothing opens over that
  const labelOpen = link.isConnected && link.closest(".line-item")?.querySelector(".peek")?.getAttribute("aria-expanded") === "true";
  if (!labelOpen || big.naturalWidth === 0) return empty();
  frame = link;
  // A classic scrollbar goes while the dialog is open (overflow: hidden), and the page would shift under the picture and
  // its frame. Its width stays as padding instead: scrollbar-gutter doesn't hold on the root in Chromium
  const bar = Math.max(0, innerWidth - document.documentElement.clientWidth);
  if (bar) document.documentElement.style.paddingRight = `${bar}px`;
  dialog.showModal();
  const from = shot.getBoundingClientRect(); // reading a rect also settles the dialog's first style, so the veil fades in from clear
  dialog.classList.add("on");
  shot.style.visibility = "hidden";
  if (reduced()) return;
  big.style.transition = "none";
  big.style.transform = flip(from, big.getBoundingClientRect());
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (closing) return; // closed in these two frames: the close has its own transform
      big.style.transition = "transform 420ms var(--ease-out-quint)";
      big.style.transform = "none";
    }),
  );
}

// Back in the frame: its snapshot shown, the dialog emptied and focus on the frame. A close the browser forces comes
// here too, as it cuts the return short
function restore() {
  if (!dialog || !big || !frame) return;
  const link = frame;
  const shot = link.querySelector("img");
  window.clearTimeout(timer);
  big.removeEventListener("transitionend", restore);
  if (dialog.open) dialog.close();
  if (shot) shot.style.visibility = "";
  big.style.transition = "none";
  big.style.transform = "";
  empty();
  document.documentElement.style.paddingRight = "";
  closing = false;
  frame = null;
  link.focus();
}

function close() {
  if (!dialog?.open || !big || !frame || closing) return;
  const shot = frame.querySelector("img");
  closing = true;
  dialog.classList.remove("on");
  if (reduced() || !shot) return restore();
  const rest = restBox(big);
  big.style.transition = "transform 300ms var(--ease-out)";
  big.style.transform = flip(shot.getBoundingClientRect(), rest);
  big.addEventListener("transitionend", restore, { once: true });
  timer = window.setTimeout(restore, 400); // in case the transition never ends (a tab in the background)
}

if (dialog) {
  // A frame is a link to its big file, which is what it opens without this script (or with a modifier key, in a new tab)
  document.querySelectorAll<HTMLAnchorElement>("a.frame").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void open(link);
    }),
  );
  dialog.addEventListener("click", close); // the veil, the image and the close button all put it back
  // Esc closes the closer look first; the label's own Esc handler only hears the next one, once focus is back in it
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  // A second Esc inside the return can't be stopped: the browser closes the dialog itself, so settle it at once
  dialog.addEventListener("close", restore);
}
