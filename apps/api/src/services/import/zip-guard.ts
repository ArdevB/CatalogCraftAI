/**
 * An .xlsx file is a ZIP archive. A "zip bomb" is a tiny upload that expands
 * to gigabytes when unpacked and exhausts the server's memory. Before handing
 * a workbook to the parser we read the ZIP's central directory (its table of
 * contents, which lists every entry's unpacked size) and refuse files that
 * would expand beyond a sane limit.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP64_MARKER = 0xffffffff;

export type ZipCheck =
  | { ok: true; entries: number; uncompressedBytes: number }
  | { ok: false; reason: string };

export function inspectZip(data: Buffer, limits: { maxUncompressedBytes: number; maxEntries: number }): ZipCheck {
  // The End Of Central Directory record sits in the last 22 bytes (+ up to 64 KB comment).
  const searchStart = Math.max(0, data.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= searchStart; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) return { ok: false, reason: 'not a valid ZIP archive' };

  const entryCount = data.readUInt16LE(eocd + 10);
  const directoryOffset = data.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directoryOffset === ZIP64_MARKER) return { ok: false, reason: 'ZIP64 archives are not supported' };
  if (entryCount > limits.maxEntries) return { ok: false, reason: 'the archive contains too many files' };

  let offset = directoryOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
      return { ok: false, reason: 'the archive directory is damaged' };
    }
    const uncompressed = data.readUInt32LE(offset + 24);
    if (uncompressed === ZIP64_MARKER) return { ok: false, reason: 'ZIP64 archives are not supported' };
    total += uncompressed;
    if (total > limits.maxUncompressedBytes) return { ok: false, reason: 'the workbook expands to too much data' };
    offset += 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
  return { ok: true, entries: entryCount, uncompressedBytes: total };
}
