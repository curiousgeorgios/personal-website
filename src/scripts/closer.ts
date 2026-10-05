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
let frame: HTMLButtonElement | null = null;
let closing = false;

async function open(button: HTMLButtonElement) {
  if (!dialog || !big || !source || dialog.open) return;
  const shot = button.querySelector("img");
  if (!shot) return;
  frame = button;
  source.srcset = button.dataset.closerAvif ?? "";
  big.src = button.dataset.closerWebp ?? "";
  big.alt = shot.alt;
  dialog.setAttribute("aria-label", `closer look: ${shot.alt}`);
  await big.decode().catch(() => {}); // a big file that won't decode still opens, as the browser draws it
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

function close() {
  if (!dialog?.open || !big || !frame || closing) return;
  const button = frame;
  const shot = button.querySelector("img");
  closing = true;
  dialog.classList.remove("on");
  const done = () => {
    dialog.close();
    if (shot) shot.style.visibility = "";
    big.style.transition = "none";
    big.style.transform = "";
    big.removeAttribute("src");
    source?.removeAttribute("srcset");
    closing = false;
    frame = null;
    button.focus();
  };
  if (reduced() || !shot) return done();
  const rest = restBox(big);
  big.style.transition = "transform 300ms var(--ease-out)";
  big.style.transform = flip(shot.getBoundingClientRect(), rest);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  big.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, 400); // in case the transition never ends (a tab in the background)
}

if (dialog) {
  document.querySelectorAll<HTMLButtonElement>("button.frame").forEach((button) => button.addEventListener("click", () => void open(button)));
  dialog.addEventListener("click", close); // the veil, the image and the close button all put it back
  // Esc closes the closer look first; the label's own Esc handler only hears the next one, once focus is back in it
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
}
