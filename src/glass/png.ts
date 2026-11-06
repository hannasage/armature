/**
 * A PNG encoder with no dependencies and no canvas. It writes 8-bit RGBA, filter type 0, and "stored"
 * (uncompressed) deflate blocks, so it runs in Node, in a worker, and during server rendering.
 * Stored blocks make the file about the size of the raw pixels. Keep the images small.
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (the PNG and zip kind) of `bytes`, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32 of `bytes`, as an unsigned 32-bit number. */
export function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  // 5552 is the longest run that cannot overflow 32 bits before the modulo.
  const BLOCK = 5552;
  let a = 1;
  let b = 0;
  for (let start = 0; start < bytes.length; start += BLOCK) {
    const end = Math.min(start + BLOCK, bytes.length);
    for (let i = start; i < end; i += 1) {
      a += bytes[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with padding. `btoa` is not used, because it is missing from some runtimes. */
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunk = 3 * 4096;
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(start + chunk, bytes.length);
    let out = "";
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += BASE64[n >> 18] + BASE64[(n >> 12) & 63] + BASE64[(n >> 6) & 63] + BASE64[n & 63];
    }
    if (i < end) {
      const rest = end - i;
      const n = (bytes[i] << 16) | ((rest > 1 ? bytes[i + 1] : 0) << 8);
      out += BASE64[n >> 18] + BASE64[(n >> 12) & 63] + (rest > 1 ? BASE64[(n >> 6) & 63] : "=") + "=";
    }
    parts.push(out);
  }
  return parts.join("");
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Wraps `raw` in a zlib stream made of stored blocks, each at most 65535 bytes. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let position = 2;
  for (let block = 0; block < blocks; block += 1) {
    const start = block * MAX;
    const length = Math.min(MAX, raw.length - start);
    out[position] = block === blocks - 1 ? 1 : 0;
    out[position + 1] = length & 0xff;
    out[position + 2] = length >>> 8;
    out[position + 3] = ~length & 0xff;
    out[position + 4] = (~length >>> 8) & 0xff;
    out.set(raw.subarray(start, start + length), position + 5);
    position += 5 + length;
  }
  writeUint32(out, position, adler32(raw));
  return out;
}

/** Encodes `rgba` (4 bytes per pixel, rows top to bottom) as a PNG. Throws on a bad size or a wrong length. */
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("PNG size must be positive whole numbers.");
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(`Expected ${width * height * 4} pixel bytes for ${width} by ${height}, got ${rgba.length}.`);
  }
  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  // Compression, filter, and interlace stay 0.

  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    // Byte 0 of each row is the filter type: 0, none.
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }

  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A `data:image/png;base64,...` URI for `rgba`. */
export function pngDataUri(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): string {
  return `data:image/png;base64,${toBase64(encodePng(width, height, rgba))}`;
}
