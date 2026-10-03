export interface Light {
  mood: "day" | "golden" | "night";
  key: { color: number; intensity: number; position: [number, number, number] };
  bounce: number;
  environment: number;
  candle: number;
  glow: { opacity: number; scale: number };
}

const SYDNEY = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" });

export function sydneyHour(date: Date): number {
  const parts = SYDNEY.formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") + part("minute") / 60;
}

// Daylight, golden hour from 16:00 to 19:00, night light from 19:00 to 06:00 with a brighter candle (spec 5.2)
export function lightFor(date: Date): Light {
  const hour = sydneyHour(date);
  if (hour >= 19 || hour < 6) {
    return {
      mood: "night",
      key: { color: 0xffc58a, intensity: 1.4, position: [-5, 8, 6] },
      bounce: 0.34,
      environment: 0.28,
      candle: 9,
      glow: { opacity: 0.8, scale: 1.6 },
    };
  }
  // The sun swings from left to right across the day
  const t = Math.max(-1, Math.min(1, (hour - 12.5) / 6.5));
  const golden = hour >= 16;
  return {
    mood: golden ? "golden" : "day",
    key: { color: golden ? 0xffcf9e : 0xffe2c2, intensity: golden ? 2.2 : 2.3, position: [-6 - t * 4, 12, 8] },
    bounce: 0.6,
    environment: 0.45,
    candle: 4,
    glow: { opacity: 0.5, scale: 1.1 },
  };
}
