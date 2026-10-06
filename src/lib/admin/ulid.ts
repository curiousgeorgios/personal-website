const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const randomBytes = (count: number) => crypto.getRandomValues(new Uint8Array(count));

/** A lowercase ULID: 10 characters of milliseconds then 16 random ones, so R2 keys are unique and sort by upload time */
export function ulid(now = Date.now(), random: (count: number) => Uint8Array = randomBytes): string {
  let time = "";
  for (let rest = now, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) time = ALPHABET[rest % 32] + time;
  let tail = "";
  for (const byte of random(16)) tail += ALPHABET[byte % 32];
  return time + tail;
}
