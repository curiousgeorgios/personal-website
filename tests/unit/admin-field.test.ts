import { describe, expect, test } from "vitest";
import Field from "../../src/components/admin/Field.astro";
import { render, text } from "./render";

describe("Field", () => {
  test("labels its control and keeps the value, escaped", async () => {
    const doc = await render(Field, { form: "fact-shelf", name: "title", label: "title", value: '<b>"piranesi"</b>', maxlength: 80 });
    const input = doc.querySelector("input")!;
    expect(input.id).toBe("fact-shelf-title");
    expect(input.getAttribute("name")).toBe("title");
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("value")).toBe('<b>"piranesi"</b>');
    expect(input.getAttribute("maxlength")).toBe("80");
    expect(input.hasAttribute("required")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(doc.querySelector("label")!.getAttribute("for")).toBe("fact-shelf-title");
    expect(doc.querySelector("b")).toBeNull();
  });

  test("a message marks the control invalid and is read with it, after the hint", async () => {
    const doc = await render(Field, { form: "fact-shelf", name: "title", label: "title", error: "a title is needed, or clear both to hide it", hint: "clear both to hide it" });
    const input = doc.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("fact-shelf-title-hint fact-shelf-title-error");
    expect(text(doc.querySelector("#fact-shelf-title-error"))).toBe("a title is needed, or clear both to hide it");
    expect(doc.querySelector(".field")!.classList.contains("invalid")).toBe(true);
  });

  test("a hint alone is the control's whole description", async () => {
    const doc = await render(Field, { form: "fact-shelf", name: "title", label: "title", hint: "clear both to hide it" });
    expect(doc.querySelector("input")!.getAttribute("aria-describedby")).toBe("fact-shelf-title-hint");
  });

  test("with neither a hint nor a message, the control describes nothing", async () => {
    const doc = await render(Field, { form: "fact-shelf", name: "title", label: "title" });
    expect(doc.querySelector("input")!.hasAttribute("aria-describedby")).toBe(false);
  });

  test("text, textarea and url controls keep iOS from capitalising; the rest don't say", async () => {
    const attribute = async (kind: string) => {
      const doc = await render(Field, { form: "f", name: "n", label: "n", kind, options: [["a", "a"]] });
      return doc.querySelector("input, textarea, select")!.getAttribute("autocapitalize");
    };
    expect(await Promise.all(["text", "textarea", "url"].map(attribute))).toEqual(["none", "none", "none"]);
    expect(await Promise.all(["date", "select", "file"].map(attribute))).toEqual([null, null, null]);
  });

  test("plain turns off autocorrect and spellcheck; so does a url field, and nothing else does", async () => {
    const attributes = async (props: Record<string, unknown>) => {
      const doc = await render(Field, { form: "f", name: "n", label: "n", ...props });
      const control = doc.querySelector("input, textarea")!;
      return [control.getAttribute("autocorrect"), control.getAttribute("spellcheck")];
    };
    expect(await attributes({ plain: true })).toEqual(["off", "false"]);
    expect(await attributes({ plain: true, kind: "textarea" })).toEqual(["off", "false"]);
    expect(await attributes({ kind: "url" })).toEqual(["off", "false"]);
    expect(await attributes({})).toEqual([null, null]);
    expect(await attributes({ kind: "textarea" })).toEqual([null, null]);
  });

  test("a select marks the saved choice", async () => {
    const options = [["", "none"], ["decision", "decision"], ["lesson", "lesson"]];
    const doc = await render(Field, { form: "item-1", name: "label_kind", label: "kind", kind: "select", value: "lesson", options });
    expect(doc.querySelectorAll("select option")).toHaveLength(3);
    expect([...doc.querySelectorAll("option[selected]")].map((option) => option.getAttribute("value"))).toEqual(["lesson"]);
  });

  test("a textarea holds its text as content", async () => {
    const doc = await render(Field, { form: "log-new", name: "text", label: "entry", kind: "textarea", value: "shipped <it>.", required: true });
    const area = doc.querySelector("textarea")!;
    // Escaped in the HTML; linkedom keeps a textarea's character references as written, where a browser shows "shipped <it>."
    expect(area.innerHTML).toBe("shipped &lt;it&gt;.");
    expect(area.hasAttribute("required")).toBe(true);
    expect(doc.querySelector("it")).toBeNull();
  });

  test("a file input takes its accept list and never a value", async () => {
    const doc = await render(Field, { form: "record-new", name: "cover", label: "cover", kind: "file", accept: "image/jpeg,image/png,image/webp", value: "x" });
    const input = doc.querySelector("input")!;
    expect(input.getAttribute("type")).toBe("file");
    expect(input.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
    expect(input.hasAttribute("value")).toBe(false);
  });
});
