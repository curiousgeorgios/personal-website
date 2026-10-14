// The poster that stands in for the scene (spec 5.2). From 19:00 to 06:00 in Sydney the scene is candlelit (lighting.ts),
// so its poster is the night one. The page is cached at the edge for a day, so the server can't choose: this runs inline,
// straight after the poster's <picture> and before it paints, so only one poster is ever fetched. Without JavaScript, or
// if the hour can't be read, the day poster shows. It also marks the deck data-night, and the scene keeps that mood for the visit, so a visit
// that crosses 19:00 or 06:00 doesn't swap the light at take-over. astro.config.mjs allows exactly this text by its hash, and
// Turntable.astro renders it unchanged.
//
// It reads Sydney's hour with Date alone. Intl.DateTimeFormat costs about 55ms of a 4x-throttled phone's main thread on
// first use (Chromium loads its locale data), and this script blocks parsing before the page's first paint. New South Wales
// changes its clocks at 16:00 UTC on the Saturday before the first Sunday of April (03:00 AEDT back to 02:00) and of
// October (02:00 AEST on to 03:00); unit tests compare its hour, and its poster choice, with Intl's own time-zone data.
export const NIGHT_POSTER = `(() => {
  const picture = document.currentScript.previousElementSibling;
  const now = new Date();
  const year = now.getUTCFullYear();
  // 16:00 UTC on the Saturday before the month's first Sunday (day 0 is the last of the month before)
  const change = (month) => Date.UTC(year, month, (7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7, 16);
  const time = now.getTime();
  const hour = (now.getUTCHours() + (time < change(3) || time >= change(9) ? 11 : 10)) % 24;
  // Written so that anything unreadable (NaN) keeps the day poster, as no JavaScript does
  if (!(hour < 6 || hour >= 19)) return;
  picture.parentElement.setAttribute("data-night", "");
  for (const element of picture.querySelectorAll("source, img")) {
    const name = element.tagName === "IMG" ? "src" : "srcset";
    element.setAttribute(name, element.getAttribute(name).replace(/\\.webp$/, "-night.webp"));
  }
})();`;
