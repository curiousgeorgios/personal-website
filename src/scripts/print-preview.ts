// The print preview's announcement (spec 15.1 as amended). The drawing and its caption follow the radios through CSS
// alone; this only tells a screen reader what the caption now says, because a radio's name gives the size or the frame
// but never the two together with their price. Without it, the row works and reads the same.

const form = document.querySelector<HTMLFormElement>("form#prints");
const caption = form?.querySelector(".preview-caption");
const live = form?.querySelector(".preview-status");

if (form && caption && live) {
  form.addEventListener("change", () => {
    const data = new FormData(form);
    const lines = [...caption.querySelectorAll<HTMLElement>("[data-tier]")].filter(
      (line) => line.dataset.tier === data.get("size") && (!line.dataset.frame || line.dataset.frame === data.get("frame")),
    );
    live.textContent = lines.map((line) => line.textContent?.trim()).join(". ");
  });
}
