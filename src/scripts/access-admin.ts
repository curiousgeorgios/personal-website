// The admin's downloads section (spec 6.3 as amended): approve an email address, or revoke one, through the owner's
// JSON route behind Access. Each success lands on the saved line, as every admin save does (post, redirect, get), so a
// reload repeats nothing. Without this script the forms stay hidden and a line says why.

const ROUTE = "/admin/photos/access";

async function send(method: "POST" | "DELETE", path: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    referrerPolicy: "same-origin",
    cache: "no-store",
  });
  return response.status;
}

/** A message for a status no form expects: an ended Access session, or the route not answering */
const trouble = (status: number | null) =>
  status === 401 || status === 403 ? "your admin session has ended. reload the page to sign in again." : "that didn't work. try again in a bit.";

function say(error: HTMLElement | null, message: string, field?: HTMLInputElement | null) {
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
  field?.setAttribute("aria-invalid", message ? "true" : "false");
  const described = new Set((field?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean));
  if (error?.id) described[message ? "add" : "delete"](error.id);
  if (field) field.setAttribute("aria-describedby", [...described].join(" "));
}

function busy(button: HTMLButtonElement, on: boolean) {
  button.disabled = on;
  button.closest("form")?.setAttribute("aria-busy", String(on));
}

const approve = document.querySelector<HTMLFormElement>("form[data-access-approve]");
if (approve) {
  approve.hidden = false;
  const email = approve.querySelector<HTMLInputElement>("input[name=email]")!;
  const error = approve.querySelector<HTMLElement>("#access-new-error");
  const button = approve.querySelector<HTMLButtonElement>("button[type=submit]")!;
  approve.addEventListener("submit", async (event) => {
    event.preventDefault();
    say(error, "", email);
    email.value = email.value.trim();
    if (!email.value || !email.checkValidity()) {
      say(error, "an email address, like name@example.com", email);
      email.focus();
      return;
    }
    busy(button, true);
    let status: number | null = null;
    try {
      status = await send("POST", ROUTE, { email: email.value });
    } catch {
      status = null;
    }
    // 201 whether it was new or already approved: approving twice is one approval (ADR-0012)
    if (status === 201 || status === 200) {
      location.assign("/admin/?saved=downloads#downloads");
      return;
    }
    busy(button, false);
    say(error, status === 400 || status === 422 ? "that doesn't look like an email address." : trouble(status), email);
    email.focus();
  });
}

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-access-revoke]")) {
  form.hidden = false;
  const confirm = form.querySelector<HTMLInputElement>("input[name=confirm]")!;
  const error = form.querySelector<HTMLElement>(".error");
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    say(error, "", confirm);
    if (!confirm.checked) {
      say(error, "tick the box to revoke it", confirm);
      confirm.focus();
      return;
    }
    busy(button, true);
    let status: number | null = null;
    try {
      status = await send("DELETE", `${ROUTE}?id=${encodeURIComponent(form.dataset.accessRevoke ?? "")}`);
    } catch {
      status = null;
    }
    // Already revoked counts as saved (ADR-0012)
    if (status === 200 || status === 204 || status === 404) {
      location.assign("/admin/?saved=downloads&note=revoked#downloads");
      return;
    }
    busy(button, false);
    say(error, trouble(status), confirm);
  });
}
