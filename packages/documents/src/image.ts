/** PNG: build the fixtures and read their dimensions from the bytes.
 *
 * Image reading here is deliberately modest. Dimensions and the presence of a region come from
 * the file; whether small text in an image says one thing or another does not. OCR is not
 * installed, so text in an image is reported as requiring visual inspection and stays
 * uncertain rather than being guessed at.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { crc32 } from './zip.js';

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.byteLength, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Builds an RGB PNG. `marks` paints darker rectangles, which stand in for the small text a
 * reviewer would have to look at. */
export function buildPng(input: {
  width: number; height: number;
  marks?: Array<{ x: number; y: number; width: number; height: number }>;
}): Buffer {
  const raw = Buffer.alloc(input.height * (1 + input.width * 3), 0xff);
  for (let y = 0; y < input.height; y += 1) raw[y * (1 + input.width * 3)] = 0;
  for (const mark of input.marks ?? []) {
    for (let y = mark.y; y < Math.min(mark.y + mark.height, input.height); y += 1) {
      for (let x = mark.x; x < Math.min(mark.x + mark.width, input.width); x += 1) {
        const at = y * (1 + input.width * 3) + 1 + x * 3;
        raw[at] = 0x20; raw[at + 1] = 0x20; raw[at + 2] = 0x20;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(input.width, 0);
  header.writeUInt32BE(input.height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export type ImageRead = {
  media_type: 'image/png';
  width: number;
  height: number;
  /** Regions darker than their surroundings: where a reviewer would have to look. */
  regions_of_interest: Array<{ x: number; y: number; width: number; height: number }>;
  /** Always true here. No OCR engine is installed, so text in an image stays uncertain. */
  text_uncertain: boolean;
  ocr: { available: false; reason: 'NO_OCR_ENGINE_INSTALLED' };
};

export function readPng(bytes: Buffer): ImageRead {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('NOT_A_PNG');
  return {
    media_type: 'image/png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    // Region geometry is not recovered from the compressed raster here; the inventory records
    // that the image needs visual inspection, which is the honest state.
    regions_of_interest: [],
    text_uncertain: true,
    ocr: { available: false, reason: 'NO_OCR_ENGINE_INSTALLED' },
  };
}

/** Content sniffing from bytes, never from the filename. */
export function sniffMediaType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(SIGNATURE)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return 'application/zip';
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'application/x-ole-storage';
  return null;
}

/** Decodes a non-interlaced 8-bit PNG (grey, RGB or RGBA) far enough to measure how much of
 * the page carries ink. A rendered page that should have text on it and comes back blank is a
 * layout failure — clipped, overflowed or drawn outside the page box — and measuring it is the
 * only way to tell the difference between "rendered fine" and "rendered nothing".
 */
export function inkCoverage(bytes: Buffer): { width: number; height: number; ink_ratio: number; sampled_pixels: number } {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('NOT_A_PNG');
  let cursor = 8;
  let width = 0; let height = 0; let depth = 0; let colourType = 0; let interlace = 0;
  const idat: Buffer[] = [];
  while (cursor < bytes.byteLength) {
    const length = bytes.readUInt32BE(cursor);
    const type = bytes.subarray(cursor + 4, cursor + 8).toString('latin1');
    const body = bytes.subarray(cursor + 8, cursor + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]!; colourType = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    cursor += 12 + length;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`UNSUPPORTED_PNG:depth=${String(depth)}:interlace=${String(interlace)}`);
  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 : colourType === 4 ? 2 : colourType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`UNSUPPORTED_PNG_COLOUR_TYPE:${String(colourType)}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      const value = line[x]!;
      current[x] = filter === 0 ? value
        : filter === 1 ? (value + left) & 0xff
          : filter === 2 ? (value + up) & 0xff
            : filter === 3 ? (value + ((left + up) >> 1)) & 0xff
              : (value + paeth(left, up, upLeft)) & 0xff;
    }
    current.copy(out, y * stride);
    previous = current;
  }
  let ink = 0;
  let sampled = 0;
  for (let index = 0; index < out.byteLength; index += channels) {
    const grey = channels >= 3 ? (out[index]! + out[index + 1]! + out[index + 2]!) / 3 : out[index]!;
    sampled += 1;
    if (grey < 240) ink += 1;
  }
  return { width, height, ink_ratio: sampled === 0 ? 0 : ink / sampled, sampled_pixels: sampled };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  return distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft ? left : distanceUp <= distanceUpLeft ? up : upLeft;
}
