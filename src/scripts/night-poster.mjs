// The poster that stands in for the scene (spec 5.2). From 19:00 to 06:00 in Sydney the scene is candlelit (lighting.ts),
// so its poster is the night one. The page is cached at the edge for a day, so the server can't choose: this runs inline,
// straight after the poster's <picture> and before it paints, so only one poster is ever fetched. Without JavaScript, or
// if the hour can't be read, the day poster shows. It also marks the deck data-night, and the scene keeps that mood for the visit, so a visit
// that crosses 19:00 or 06:00 doesn't swap the light at take-over. astro.config.mjs allows exactly this text by its hash, and
// Turntable.astro renders it unchanged.
export const NIGHT_POSTER = `(() => {
  const picture = document.currentScript.previousElementSibling;
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(new Date()));
  } catch {
    return;
  }
  // Written so that anything unreadable (NaN) keeps the day poster, as no JavaScript does
  if (!(hour < 6 || hour >= 19)) return;
  picture.parentElement.setAttribute("data-night", "");
  for (const element of picture.querySelectorAll("source, img")) {
    const name = element.tagName === "IMG" ? "src" : "srcset";
    element.setAttribute(name, element.getAttribute(name).replace(/\\.webp$/, "-night.webp"));
  }
})();`;
