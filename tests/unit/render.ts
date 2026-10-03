import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";

// Renders an Astro component to a DOM for querying (the dev renderer adds source attributes,
// so tests query elements rather than matching raw strings).
export async function render(component: Parameters<AstroContainer["renderToString"]>[0], props: Record<string, unknown>) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(component, { props });
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

export const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
