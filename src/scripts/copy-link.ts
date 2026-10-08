// The copy button beside a link just issued (spec 6.3). Without JavaScript it stays hidden and the link is selectable.
for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  const field = document.getElementById(button.dataset.copy ?? "");
  if (!(field instanceof HTMLInputElement)) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      button.textContent = "copied";
    } catch {
      // No clipboard (an older browser, a refused permission): select it so it can be copied by hand
      field.focus();
      field.select();
      button.textContent = "selected - copy it from there";
    }
  });
}
