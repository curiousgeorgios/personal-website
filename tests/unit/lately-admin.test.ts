import { expect, test } from "vitest";
import LatelyAdmin from "../../src/components/admin/LatelyAdmin.astro";
import { render, text } from "./render";

test("each lately form is named by its heading", async () => {
  const doc = await render(LatelyAdmin, { facts: { shelf: { title: "piranesi", subtitle: "susanna clarke" }, kettle: null }, failure: null });
  const forms = [...doc.querySelectorAll("form")];
  expect(forms.map((form) => form.getAttribute("aria-labelledby"))).toEqual(["fact-shelf-heading", "fact-kettle-heading"]);
  expect(forms.map((form) => text(doc.getElementById(form.getAttribute("aria-labelledby")!)))).toEqual(["on the shelf", "in the kettle"]);
});
