import { SNAPSHOT_WIDTHS, snapshotVariant, type SnapshotFormat, type SnapshotWidth } from "../../../src/lib/snapshots";

/** Spec 11: the 480px variant under 30KB and the 960px under 70KB; the closer look's 1920px has no budget */
export const VARIANT_BUDGETS: Partial<Record<SnapshotWidth, number>> = { 480: 30 * 1024, 960: 70 * 1024 };
const QUALITIES = [70, 60, 50, 40];
const FORMATS = [
  { format: "avif", type: "image/avif" },
  { format: "webp", type: "image/webp" },
] as const satisfies readonly { format: SnapshotFormat; type: string }[];

export interface Variant {
  key: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * A capture's six files: requested AVIF and WebP at 480, 960 and 1920 wide (scaled down, aspect kept), each stepped down in
 * quality until it fits its budget. One that never fits keeps the smallest it tried, which needn't be the last (an
 * encoder isn't always monotonic in quality); the snapshot matters more than a budget, and the warning lands in Workers Logs.
 * Images can return WebP or JPEG for a large AVIF request, so the stored type follows the selected encoded bytes.
 */
export async function makeVariants(images: ImagesBinding, png: Uint8Array, base: string): Promise<Variant[]> {
  const source = new Blob([png.slice()]);
  const variants: Variant[] = [];
  for (const width of SNAPSHOT_WIDTHS) {
    const budget = VARIANT_BUDGETS[width];
    for (const { format, type } of FORMATS) {
      let smallest: Pick<Variant, "bytes" | "type"> | undefined;
      for (const quality of QUALITIES) {
        const result = await images.input(source.stream()).transform({ width, fit: "scale-down" }).output({ format: type, quality });
        const attempt = new Uint8Array(await new Response(result.image()).arrayBuffer());
        if (!smallest || attempt.byteLength < smallest.bytes.byteLength) smallest = { bytes: attempt, type: result.contentType() };
        if (budget === undefined || attempt.byteLength < budget) break;
      }
      const { bytes, type: contentType } = smallest!;
      const key = snapshotVariant(base, width, format);
      if (budget !== undefined && bytes.byteLength >= budget) console.warn(`snapshots: ${key} is ${bytes.byteLength} bytes, over its ${budget} budget`);
      variants.push({ key, type: contentType, bytes });
    }
  }
  return variants;
}
