import { describe, expect, test } from "vitest";
import { sniffAudio, sniffImage } from "../../src/lib/admin/sniff";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

describe("sniffAudio", () => {
  test.each([
    ["an ID3 tag", bytes(0x49, 0x44, 0x33, 4, 0), "mp3"],
    ["an MPEG-1 layer III frame", bytes(0xff, 0xfb, 0x90, 0x64), "mp3"],
    ["an MPEG-2 layer III frame", bytes(0xff, 0xf3, 0x48, 0xc4), "mp3"],
    ["an AAC (ADTS) frame", bytes(0xff, 0xf1, 0x50, 0x80), null],
    ["a PNG", bytes(0x89, 0x50, 0x4e, 0x47), null],
    ["nothing", bytes(), null],
  ])("%s", (_name, head, expected) => {
    expect(sniffAudio(head)).toBe(expected);
  });
});

describe("sniffImage", () => {
  test.each([
    ["a JPEG", bytes(0xff, 0xd8, 0xff, 0xe0), "jpeg"],
    ["a PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13), "png"],
    ["a WebP", ascii("RIFF\u0000\u0000\u0000\u0000WEBP"), "webp"],
    ["a WAV (RIFF but not WebP)", ascii("RIFF\u0000\u0000\u0000\u0000WAVE"), null],
    ["an SVG", ascii('<svg xmlns="http://www.w3.org/2000/svg">'), null],
    ["a GIF", ascii("GIF89a"), null],
    ["too short to tell", bytes(0xff, 0xd8), null],
  ])("%s", (_name, head, expected) => {
    expect(sniffImage(head)).toBe(expected);
  });
});
