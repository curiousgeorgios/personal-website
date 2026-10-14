import { sydneyTime } from "../lib/time";

function tick() {
  const value = sydneyTime(new Date());
  document.querySelectorAll<HTMLElement>("[data-sydney-time]").forEach((el) => { el.textContent = value; });
}

// The first tick waits for the page's first frame: building Intl's formatter costs a 4x-throttled phone about 55ms, and
// run straight away it can hold the first paint. The clock keeps its 8ch box (notebook.css), so the dash's swap moves nothing
requestAnimationFrame(() => setTimeout(() => {
  tick();
  setInterval(tick, 30_000);
}));
