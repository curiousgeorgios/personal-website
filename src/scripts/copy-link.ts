// The copy button beside a link just issued (spec 6.3). Without JavaScript it stays hidden and the link is selectable.
const issued = document.querySelector(".issued");
for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  const field = document.getElementById(button.dataset.copy ?? "");
  if (!(field instanceof HTMLInputElement)) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      button.textContent = "copied";
    } catch {
      // No clipboard (an older browser, a refused permission): select it so it can be copied by hand. iOS Safari
      // ignores select() on an input, so the range is set as well.
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      button.textContent = "selected - copy it from there";
    }
  });
}

// The link is shown once: leaving the page clears it, so the back-forward cache can't bring it back. Without
// JavaScript, no-store already keeps this response out of history.
addEventListener("pagehide", () => {
  for (const field of document.querySelectorAll<HTMLInputElement>(".issued input")) field.value = "";
  issued?.remove();
});
