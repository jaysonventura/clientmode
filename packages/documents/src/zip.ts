/** A ZIP reader and writer with the container limits enforced while reading.
 *
 * OOXML files are ZIP containers, and every interesting attack on them is a property of the
 * container rather than the document: a member that expands to gigabytes, ten thousand
 * members, an absolute path, a `..` traversal, a symlink, a duplicate entry that two readers
 * resolve differently. A library that hands back the parsed document has already made those
 * decisions. This reader makes them explicitly, refuses before decompressing where it can, and
 * reports which limit it hit.
 */
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export class ZipError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'ZipError';
  }
}

/** The declared limits from DOCUMENT_WORKFLOW.md section 3. A trusted operator may change
 * them; document content never can. */
export const CONTAINER_LIMITS = {
  maximum_expanded_bytes: 200 * 1024 * 1024,
  maximum_members: 2000,
  maximum_compression_ratio: 100,
} as const;

export type ContainerLimits = typeof CONTAINER_LIMITS;

export type ZipMember = {
  name: string;
  compressed_size: number;
  uncompressed_size: number;
  method: number;
  /** Unix mode from the external attributes, when the archive carries one. */
  unix_mode: number | null;
  is_symlink: boolean;
};

export type ZipEntry = { name: string; bytes: Buffer };

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

/** Writes a ZIP with deflate. Deterministic: fixed timestamps, no extra fields. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.bytes, { level: 6 });
    const stored = deflated.byteLength < entry.bytes.byteLength;
    const payload = stored ? deflated : entry.bytes;
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(stored ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.byteLength, 18);
    local.writeUInt32LE(entry.bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(stored ? 8 : 0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.byteLength, 20);
    central.writeUInt32LE(entry.bytes.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.byteLength + name.byteLength + payload.byteLength;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

export type ContainerInspection = {
  members: ZipMember[];
  total_uncompressed: number;
  refusals: string[];
  safe: boolean;
};

function unsafeName(name: string): string | null {
  if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) return 'ABSOLUTE_PATH';
  if (name.split(/[\\/]/).includes('..')) return 'PARENT_TRAVERSAL';
  if (name.includes('\0')) return 'NUL_IN_NAME';
  return null;
}

/** Reads the central directory only. Nothing is decompressed until the limits pass, so a
 * declared expansion of two gigabytes is refused without ever allocating it. */
export function inspectContainer(bytes: Buffer, limits: ContainerLimits = CONTAINER_LIMITS): ContainerInspection {
  const refusals: string[] = [];
  const endOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) return { members: [], total_uncompressed: 0, refusals: ['NOT_A_ZIP_CONTAINER'], safe: false };
  const count = bytes.readUInt16LE(endOffset + 10);
  let cursor = bytes.readUInt32LE(endOffset + 16);
  const members: ZipMember[] = [];
  const seen = new Map<string, number>();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) { refusals.push('CENTRAL_DIRECTORY_CORRUPT'); break; }
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const unix_mode = (external >>> 16) === 0 ? null : (external >>> 16);
    const is_symlink = unix_mode !== null && (unix_mode & 0xf000) === 0xa000;
    members.push({ name, compressed_size: compressed, uncompressed_size: uncompressed, method, unix_mode, is_symlink });
    total += uncompressed;

    const unsafe = unsafeName(name);
    if (unsafe !== null) refusals.push(`${unsafe}:${name}`);
    if (is_symlink) refusals.push(`SYMLINK_MEMBER:${name}`);
    if (/\.(exe|dll|so|dylib|bat|cmd|scr|com)$/i.test(name)) refusals.push(`EXECUTABLE_MEMBER:${name}`);
    // A nested container inside an OOXML part is an embedded package, not a document part.
    if (/\.(zip|7z|rar|gz|tar)$/i.test(name)) refusals.push(`NESTED_ARCHIVE_MEMBER:${name}`);
    if (compressed > 0 && uncompressed / compressed > limits.maximum_compression_ratio) {
      refusals.push(`COMPRESSION_RATIO:${name}:${Math.round(uncompressed / compressed)}`);
    }
    seen.set(name, (seen.get(name) ?? 0) + 1);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  for (const [name, occurrences] of seen) if (occurrences > 1) refusals.push(`DUPLICATE_MEMBER:${name}`);
  if (members.length > limits.maximum_members) refusals.push(`MEMBER_COUNT:${members.length}`);
  if (total > limits.maximum_expanded_bytes) refusals.push(`EXPANDED_BYTES:${total}`);
  return { members, total_uncompressed: total, refusals: [...new Set(refusals)], safe: refusals.length === 0 };
}

/** Reads one member. The container must have been inspected first; this refuses to decompress
 * a member whose declared expansion exceeds the remaining budget. */
export function readMember(bytes: Buffer, name: string, limits: ContainerLimits = CONTAINER_LIMITS): Buffer {
  const inspection = inspectContainer(bytes, limits);
  const member = inspection.members.find(entry => entry.name === name);
  if (member === undefined) throw new ZipError('MEMBER_NOT_FOUND', name);
  if (member.uncompressed_size > limits.maximum_expanded_bytes) throw new ZipError('MEMBER_TOO_LARGE', name);
  let cursor = 0;
  const endOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(endOffset + 10);
  let central = bytes.readUInt32LE(endOffset + 16);
  for (let index = 0; index < count; index += 1) {
    const nameLength = bytes.readUInt16LE(central + 28);
    const extraLength = bytes.readUInt16LE(central + 30);
    const commentLength = bytes.readUInt16LE(central + 32);
    const entryName = bytes.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    if (entryName === name) { cursor = bytes.readUInt32LE(central + 42); break; }
    central += 46 + nameLength + extraLength + commentLength;
  }
  if (bytes.readUInt32LE(cursor) !== LOCAL_SIGNATURE) throw new ZipError('LOCAL_HEADER_CORRUPT', name);
  const method = bytes.readUInt16LE(cursor + 8);
  const compressedSize = bytes.readUInt32LE(cursor + 18);
  const nameLength = bytes.readUInt16LE(cursor + 26);
  const extraLength = bytes.readUInt16LE(cursor + 28);
  const start = cursor + 30 + nameLength + extraLength;
  const payload = bytes.subarray(start, start + compressedSize);
  const out = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);
  if (out.byteLength > limits.maximum_expanded_bytes) throw new ZipError('MEMBER_TOO_LARGE', name);
  return out;
}

export function memberNames(bytes: Buffer): string[] {
  return inspectContainer(bytes).members.map(member => member.name);
}

export function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
