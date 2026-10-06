import { sydneyTime } from "../lib/time";

function tick() {
  const value = sydneyTime(new Date());
  document.querySelectorAll<HTMLElement>("[data-sydney-time]").forEach((el) => { el.textContent = value; });
}

tick();
setInterval(tick, 30_000);
