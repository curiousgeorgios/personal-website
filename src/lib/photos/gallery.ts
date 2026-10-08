// Names, dates and frames for the gallery's pages (spec 3 and 4). Pure, and shared by the server's components and the
// browser's photo-sheet script, so the store is imported for its types only.
import { formatLogDate } from "../text";
import type { PublicPhoto, PublicPreview } from "./store";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A date in words, for alt text and descriptions: 2 february 2025 */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** An entry's heading as text: 02.02.25 · bondi, sydney, or just the date when the place is unknown */
export const dateAndPlace = (date: string, place: string | null) => (place ? `${formatLogDate(date, "day")} · ${place}` : formatLogDate(date, "day"));

/** The slide number from the id, like a contact sheet's edge number: DFkL1xrsnOH-02 shows 02, even when other slides are hidden */
export const frameNumber = (id: string) => id.slice(id.lastIndexOf("-") + 1);

/** The title when George has written one, otherwise photo 2 of 14 from 2 february 2025, bondi, sydney (spec 3.2) */
export function photoAlt(photo: Pick<PublicPhoto, "title" | "date" | "place">, index: number, total: number): string {
  if (photo.title) return photo.title;
  return `photo ${index + 1} of ${total} from ${longDate(photo.date)}${photo.place ? `, ${photo.place}` : ""}`;
}

export const previewOf = (photo: Pick<PublicPhoto, "previews">, size: number, format: "avif" | "webp"): PublicPreview | undefined =>
  photo.previews.find((preview) => preview.format === format && preview.url.endsWith(`/${size}.${format}`));

/** A srcset of these sizes in one format, each preview described by its real width */
export function srcsetOf(photo: Pick<PublicPhoto, "previews">, sizes: readonly number[], format: "avif" | "webp"): string {
  return sizes
    .map((size) => previewOf(photo, size, format))
    .filter((preview): preview is PublicPreview => preview !== undefined)
    .map((preview) => `${preview.url} ${preview.width}w`)
    .join(", ");
}

/** Frames are 120px tall and 88px on a phone (spec 3.2), their width following the ratio */
export const FRAME_HEIGHT = 120;
export const PHONE_FRAME_HEIGHT = 88;
/** The notebook's phone breakpoint (notebook.css), so the frames change with the layout */
export const PHONE_MEDIA = "(max-width: 680px)";

/** The frame's rendered width at each height, so a portrait at 2× takes the 240 and a landscape the 480 (spec 3.3) */
export function frameSizes(width: number, height: number): string {
  return `${PHONE_MEDIA} ${Math.round((PHONE_FRAME_HEIGHT * width) / height)}px, ${Math.round((FRAME_HEIGHT * width) / height)}px`;
}

/** Everything one frame's markup needs; the server renders it and the photo-sheet script fills a cloned frame with it */
export interface FrameView {
  href: string;
  avif: string;
  webp: string;
  /** The 240s alone, for phones: a 3× phone would otherwise take the 480 for an 88px frame, over the image budget */
  phoneAvif: string;
  phoneWebp: string;
  src: string;
  sizes: string;
  width: number;
  height: number;
  alt: string;
  number: string;
}

/** A frame for the photograph at `index` of the `total` published in its post; null without a 240 preview (never for a published one) */
export function frameView(photo: PublicPhoto, index: number, total: number): FrameView | null {
  const small = previewOf(photo, 240, "webp");
  if (!small) return null;
  return {
    href: `/photos/${photo.id}`,
    avif: srcsetOf(photo, [240, 480], "avif"),
    webp: srcsetOf(photo, [240, 480], "webp"),
    phoneAvif: srcsetOf(photo, [240], "avif"),
    phoneWebp: srcsetOf(photo, [240], "webp"),
    src: small.url,
    sizes: frameSizes(small.width, small.height),
    width: small.width,
    height: small.height,
    alt: photoAlt(photo, index, total),
    number: frameNumber(photo.id),
  };
}

/** Only the first row of the page's first entry loads eagerly: eight frames at most (spec 3.3) */
export const EAGER_FRAMES = 8;

/**
 * The photo page's sizes (spec 4). The picture is capped at 82svh, which narrows a portrait, so its width follows its
 * ratio: a 2:3 portrait on a 900px-tall laptop is about 492px wide and fetches the 960, not the 1600. On a phone the
 * column is the viewport less 67px (24px padding each side, the 18px gap and the 1px rule), and the breakpoint is the notebook's.
 */
export function photoSizes(width: number, height: number): string {
  const ratio = Number((width / height).toFixed(4));
  return `${PHONE_MEDIA} min(calc(100vw - 67px), calc(82svh * ${ratio})), min(710px, calc(82svh * ${ratio}))`;
}

/** How one photograph is named in a line of text (spec 4; plan B's checkout, order page and emails): its title in quotes, or photo 2 of 14 from 02.02.25 */
export function photoName(photo: Pick<PublicPhoto, "title" | "date">, index: number, total: number): string {
  return photo.title ? `"${photo.title}"` : `photo ${index + 1} of ${total} from ${formatLogDate(photo.date, "day")}`;
}
