import { codeDigits, codeRequestOutcome, resendLabel, sessionOutcome, SIGN_IN_DOWN } from "../lib/photos/access-ui";

// The downloads page's sign-in and sign-out (spec 5.2 as amended). An approved person asks for a code by email, types it
// here and gets a 14-day session for this browser, an HttpOnly cookie the server sets; nothing is kept in storage and no
// address, code or token ever goes in a URL. The address typed lives in this script's memory only, for the resend. The
// page's no-referrer policy would make some browsers send Origin: null, so every write names same-origin as its referrer
// policy. Without this script the page says signing in needs JavaScript, and nothing is sent.

const page = document.querySelector<HTMLElement>("main.downloads");
const announce = (message: string) => {
  const status = page?.querySelector<HTMLElement>("[data-access-status]");
  if (status) status.textContent = message;
};

async function send(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    referrerPolicy: "same-origin",
    cache: "no-store",
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json, retryAfter: response.headers.get("Retry-After") };
}

/** A form's button busy or not: disabled with its waiting words, so a double tap sends nothing twice */
function busy(button: HTMLButtonElement, on: boolean, words: string) {
  button.dataset.words ??= button.textContent ?? "";
  button.disabled = on;
  button.textContent = on ? words : button.dataset.words;
  button.closest("form")?.setAttribute("aria-busy", String(on));
}

function showError(field: HTMLInputElement | null, error: HTMLElement | null, message: string) {
  if (error) error.textContent = message;
  if (field) field.setAttribute("aria-invalid", message ? "true" : "false");
}

function signIn(emailForm: HTMLFormElement, codeForm: HTMLFormElement) {
  const email = emailForm.querySelector<HTMLInputElement>("input[name=email]")!;
  const emailError = emailForm.querySelector<HTMLElement>(".access-error");
  const emailButton = emailForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const code = codeForm.querySelector<HTMLInputElement>("input[name=code]")!;
  const codeError = codeForm.querySelector<HTMLElement>(".access-error");
  const codeButton = codeForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const sent = codeForm.querySelector<HTMLElement>(".access-sent");
  const resend = codeForm.querySelector<HTMLButtonElement>("[data-resend]")!;
  const restart = codeForm.querySelector<HTMLButtonElement>("[data-restart]")!;
  let address = "";
  let timer = 0;
  let left = 0;
  // One request at a time: while one is out, the resend and the restart wait, and a reset (another address, or the page
  // coming back from the back-forward cache) moves the round on, so an answer from an older round is dropped
  let round = 0;
  let pending = false;

  // The resend waits as long as the server asks (60 seconds to start), counting down in its own words
  const paint = () => {
    resend.disabled = pending || left > 0;
    resend.textContent = resendLabel(left);
  };
  const cooldown = (wait: number) => {
    clearInterval(timer);
    left = wait;
    paint();
    timer = window.setInterval(() => {
      left = Math.max(0, left - 1);
      paint();
      if (left === 0) clearInterval(timer);
    }, 1000);
  };

  const hold = (on: boolean) => {
    pending = on;
    restart.disabled = on;
    paint();
  };

  async function requestCode(button: HTMLButtonElement, words: string): Promise<boolean> {
    const mine = round;
    hold(true);
    busy(button, true, words);
    try {
      const answer = await send("POST", "/api/photos/access/code", { email: address });
      if (mine !== round) return false;
      const outcome = codeRequestOutcome(answer.status, answer.json, answer.retryAfter);
      if (!outcome.ok) {
        if (outcome.retryAfter > 0) cooldown(outcome.retryAfter);
        return failed(outcome.error);
      }
      if (sent) sent.textContent = outcome.message;
      cooldown(outcome.resendAfter);
      return true;
    } catch {
      return mine === round && failed(SIGN_IN_DOWN);
    } finally {
      if (mine === round) {
        hold(false);
        busy(button, false, words);
        // Busy restored the button it used; the resend's state is the countdown's
        paint();
      }
    }
  }
  // An error belongs to whichever step is showing
  const failed = (message: string) => {
    if (codeForm.hidden) showError(email, emailError, message);
    else showError(code, codeError, message);
    return false;
  };

  emailForm.hidden = false;
  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    showError(email, emailError, "");
    email.value = email.value.trim();
    if (!email.value || !email.checkValidity()) {
      showError(email, emailError, "type the email address george approved.");
      email.focus();
      return;
    }
    address = email.value;
    const mine = round;
    if (!(await requestCode(emailButton, "sending...")) || mine !== round) return;
    emailForm.hidden = true;
    codeForm.hidden = false;
    code.value = "";
    showError(code, codeError, "");
    code.focus();
  });

  code.addEventListener("input", () => {
    const digits = codeDigits(code.value);
    if (digits !== code.value) code.value = digits;
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    showError(code, codeError, "");
    code.value = codeDigits(code.value);
    if (code.value.length !== 6) {
      showError(code, codeError, "the code is the six digits in the email.");
      code.focus();
      return;
    }
    const mine = round;
    hold(true);
    busy(codeButton, true, "signing in...");
    try {
      const answer = await send("POST", "/api/photos/access/session", { code: code.value });
      if (mine !== round) return;
      const outcome = sessionOutcome(answer.status, answer.json, answer.retryAfter);
      if (!outcome.ok) {
        if (outcome.retryAfter > 0) cooldown(outcome.retryAfter);
        showError(code, codeError, outcome.error);
        code.select();
        code.focus();
        return;
      }
      announce("signed in. loading your downloads.");
      clearInterval(timer);
      address = "";
      // The server now renders the list for this browser; replace keeps the sign-in out of the back button's way
      location.replace(location.pathname);
    } catch {
      if (mine === round) showError(code, codeError, SIGN_IN_DOWN);
    } finally {
      if (mine === round) {
        hold(false);
        busy(codeButton, false, "signing in...");
        // A wait the answer set still counts down; nothing else may enable the resend
        paint();
      }
    }
  });

  resend.addEventListener("click", async () => {
    if (pending || left > 0) return;
    showError(code, codeError, "");
    const mine = round;
    if ((await requestCode(resend, "sending...")) && mine === round) {
      code.value = "";
      code.focus();
    }
  });

  // Back to the first step with nothing kept: no address, no code, no countdown, and any answer still out dropped
  const reset = () => {
    round += 1;
    clearInterval(timer);
    left = 0;
    address = "";
    code.value = "";
    hold(false);
    for (const button of [emailButton, codeButton]) busy(button, false, "");
    paint();
    codeForm.hidden = true;
    emailForm.hidden = false;
    showError(email, emailError, "");
    showError(code, codeError, "");
    if (sent) sent.textContent = "";
  };

  restart.addEventListener("click", () => {
    if (pending) return;
    reset();
    email.focus();
  });

  // Nothing typed outlives the page, so the back-forward cache can't bring an address back; a page it does bring back
  // starts again at the address, not at a code step with nothing behind it
  addEventListener("pagehide", () => {
    address = "";
    email.value = "";
    code.value = "";
  });
  addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    reset();
    email.value = "";
  });
}

function signedIn(form: HTMLFormElement | null, expiresAt: number) {
  // Back to the sign-in, saying why: the server already treats this browser as signed out
  const ended = () => {
    announce("this browser's session has ended. sign in again to download.");
    location.replace(location.pathname);
  };
  const check = async () => {
    try {
      const answer = await send("GET", "/api/photos/access/session");
      if (answer.status === 200 && answer.json && (answer.json as { authenticated?: unknown }).authenticated === false) ended();
    } catch {
      // Offline or down: the list stays, and each download is still checked by the server
    }
  };
  // The fixed 14-day end, and George's revoke, which the server checks on every request: the list never outstays either
  const left = expiresAt * 1000 - Date.now();
  if (left <= 0) ended();
  else if (left < 2 ** 31 - 1) setTimeout(ended, left);
  addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
  addEventListener("pageshow", (event) => { if (event.persisted) void check(); });

  if (!form) return;
  form.hidden = false;
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const error = form.querySelector<HTMLElement>(".access-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (error) error.textContent = "";
    busy(button, true, "signing out...");
    try {
      const answer = await send("DELETE", "/api/photos/access/session");
      if (answer.status !== 204 && answer.status !== 200) throw new Error("not signed out");
      announce("signed out.");
      location.replace(location.pathname);
    } catch {
      if (error) error.textContent = "signing out didn't work. try again in a bit.";
      busy(button, false, "signing out...");
    }
  });
}

if (page?.dataset.access === "signin") {
  const emailForm = page.querySelector<HTMLFormElement>("#access-email");
  const codeForm = page.querySelector<HTMLFormElement>("#access-code");
  if (emailForm && codeForm) signIn(emailForm, codeForm);
} else if (page?.dataset.access === "ok") {
  signedIn(page.querySelector<HTMLFormElement>("#access-signout"), Number(page.dataset.expires));
}
