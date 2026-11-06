import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { adler32, crc32, encodePng, pngDataUri, toBase64 } from "../src/glass/png";

const text = (value: string) => new TextEncoder().encode(value);

/** Reads the chunks of a PNG. Throws on a bad signature. */
function readChunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: Array<{ type: string; data: Uint8Array; crc: number; crcOk: boolean }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8));
    const data = png.slice(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    const crcOk = crc === crc32(png.slice(offset + 4, offset + 8 + length));
    chunks.push({ type, data, crc, crcOk });
    offset += 12 + length;
  }
  expect(offset).toBe(png.length);
  return chunks;
}

function pixels(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + (i >> 3)) % 256;
  return data;
}

describe("checksums", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(text("IEND"))).toBe(0xae426082);
  });

  it("adler32 matches the standard check values", () => {
    expect(adler32(text("Wikipedia"))).toBe(0x11e60398);
    expect(adler32(new Uint8Array(0))).toBe(1);
  });

  it("adler32 stays correct on long input, where the modulo must be applied in blocks", () => {
    const long = new Uint8Array(200_000).fill(255);
    let a = 1;
    let b = 0;
    for (const byte of long) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    expect(adler32(long)).toBe(((b << 16) | a) >>> 0);
  });
});

describe("base64", () => {
  it("matches the platform encoder for every remainder length", () => {
    for (let length = 0; length < 12; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("handles a large input", () => {
    const bytes = Uint8Array.from({ length: 100_001 }, (_, i) => (i * 13) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("encodePng", () => {
  it("writes the signature, an IHDR for 8-bit RGBA, an IDAT, and an IEND, each with a valid CRC", () => {
    const chunks = readChunks(encodePng(5, 3, pixels(5, 3)));
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks.every((chunk) => chunk.crcOk)).toBe(true);
    const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
    expect(chunks[0].data.length).toBe(13);
    expect(header.getUint32(0)).toBe(5);
    expect(header.getUint32(4)).toBe(3);
    expect(Array.from(chunks[0].data.slice(8))).toEqual([8, 6, 0, 0, 0]);
    expect(chunks[2].data.length).toBe(0);
  });

  it("stores the pixels so a real inflater reads them back, one filter byte per row", () => {
    const data = pixels(7, 4);
    const chunks = readChunks(encodePng(7, 4, data));
    const raw = inflateSync(Buffer.from(chunks[1].data));
    expect(raw.length).toBe(4 * (1 + 7 * 4));
    for (let y = 0; y < 4; y += 1) {
      const row = y * (1 + 7 * 4);
      expect(raw[row]).toBe(0);
      expect(Array.from(raw.subarray(row + 1, row + 1 + 28))).toEqual(Array.from(data.subarray(y * 28, y * 28 + 28)));
    }
  });

  it("splits a large image into several stored blocks and still inflates", () => {
    const width = 120;
    const height = 200;
    const data = pixels(width, height);
    const chunks = readChunks(encodePng(width, height, data));
    const idat = chunks[1].data;
    expect(idat.length).toBeGreaterThan(65_535 + 5);
    const raw = inflateSync(Buffer.from(idat));
    expect(raw.length).toBe(height * (1 + width * 4));
    const lastRow = (height - 1) * (1 + width * 4);
    expect(Array.from(raw.subarray(lastRow + 1, lastRow + 5))).toEqual(Array.from(data.subarray((height - 1) * width * 4, (height - 1) * width * 4 + 4)));
  });

  it("starts the zlib stream with a valid header and ends it with the Adler-32 of the data", () => {
    const chunks = readChunks(encodePng(3, 2, pixels(3, 2)));
    const idat = chunks[1].data;
    expect(((idat[0] << 8) | idat[1]) % 31).toBe(0);
    expect(idat[0] & 0x0f).toBe(8);
    const raw = inflateSync(Buffer.from(idat));
    const view = new DataView(idat.buffer, idat.byteOffset, idat.byteLength);
    expect(view.getUint32(idat.length - 4)).toBe(adler32(raw));
  });

  it("rejects a pixel array of the wrong size and an empty image", () => {
    expect(() => encodePng(2, 2, new Uint8ClampedArray(3))).toThrow(/pixel/i);
    expect(() => encodePng(0, 4, new Uint8ClampedArray(0))).toThrow(/size/i);
    expect(() => encodePng(2.5, 2, new Uint8ClampedArray(20))).toThrow(/size/i);
  });

  it("is deterministic", () => {
    const a = encodePng(9, 9, pixels(9, 9));
    const b = encodePng(9, 9, pixels(9, 9));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("pngDataUri", () => {
  it("is a base64 data URI that decodes to the same PNG", () => {
    const uri = pngDataUri(4, 4, pixels(4, 4));
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = Buffer.from(uri.slice("data:image/png;base64,".length), "base64");
    expect(Array.from(decoded)).toEqual(Array.from(encodePng(4, 4, pixels(4, 4))));
  });
});
