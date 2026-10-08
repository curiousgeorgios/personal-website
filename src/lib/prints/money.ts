// How money and the rate read wherever a buyer or George sees them (spec 14.2, 16.3)

/** Australian dollars from cents: $238, or $238.50 when there are cents */
export const aud = (cents: number) => `$${cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)}`;

/** US dollars from cents, always with cents: us$30.00 */
export const usd = (cents: number) => `us$${(cents / 100).toFixed(2)}`;

/** A$ per US$1, to four decimals with trailing zeros trimmed but at least two: a$1.50, a$1.5237 */
export const rateText = (rate: number) => `a$${rate.toFixed(4).replace(/0{1,2}$/, "")}`;

/** The one plain sentence about GST wherever a buyer sees a price (spec 14.2, 17.3) */
export const gstSentence = (mode: "none" | "inclusive") =>
  mode === "inclusive" ? "prices include gst for orders posted within australia." : "prices include no gst; the seller isn't registered for gst.";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
