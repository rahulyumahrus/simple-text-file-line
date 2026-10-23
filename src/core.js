/**
 * Async iterator over text lines, with configurable buffering and
 * encoding detection from a BOM.
 */

import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

/**
 * @typedef {Object} LineIteratorOptions
 * @property {string} [encoding='utf-8'] Fallback encoding when no BOM is present.
 * @property {number} [bufferSize=65536] Read buffer size in bytes.
 */

/**
 * @typedef {Object} BomInfo
 * @property {string|null} encoding Decoded encoding name, or null if no BOM.
 * @property {number} length BOM byte length.
 */

/**
 * Map of BOM byte signatures to their encoding names. Node TextDecoder accepts
 * these case-insensitively, but we normalize to lower-case for clarity.
 */
const BOM_MAP = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: 'utf-32-be' },
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: 'utf-32-be' },
  // Note: 0xff 0xfe alone is ambiguous between UTF-16-LE and UTF-32-LE.
  // We list UTF-16-LE first, matching common tooling.
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

/**
 * Detect a BOM from the leading bytes of a buffer.
 * @param {Buffer} buf
 * @returns {BomInfo}
 */
function detectBom(buf) {
  for (const { bytes, encoding } of BOM_MAP) {
    if (buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b)) {
      return { encoding, length: bytes.length };
    }
  }
  return { encoding: null, length: 0 };
}

/**
 * Generator yielding lines from a stream of buffers.
 *
 * Implements a pre-decoder that strips a leading BOM, then buffers partial
 * line data between buffers and flushes the final line on iteration end.
 * @param {AsyncIterable<Buffer>} stream
 * @param {string} fallbackEncoding
 * @returns {AsyncGenerator<string>}
 */
async function* decodeLines(stream, fallbackEncoding) {
  let bomStripped = false;
  let pending = '';
  let decoder;

  for await (const chunk of stream) {
    if (!bomStripped) {
      const { encoding, length } = detectBom(chunk);
      const effective = encoding || fallbackEncoding;
      decoder = new TextDecoder(effective);
      let body = chunk;
      if (length > 0) body = chunk.subarray(length);
      pending += decoder.decode(body, { stream: true });
      bomStripped = true;
    } else {
      pending += decoder.decode(chunk, { stream: true });
    }

    let idx;
    while ((idx = pending.indexOf('\n')) !== -1) {
      let line = pending.slice(0, idx);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      pending = pending.slice(idx + 1);
      yield line;
    }
  }

  if (decoder) {
    pending += decoder.decode();
  }
  if (pending.length > 0) {
    if (pending.endsWith('\r')) pending = pending.slice(0, -1);
    yield pending;
  }
}

/**
 * Async iterator over the lines of a text file.
 *
 * @param {string} filePath
 * @param {LineIteratorOptions} [options]
 * @returns {AsyncGenerator<string>}
 */
export async function* createLineIterator(filePath, options = {}) {
  const fallbackEncoding = options.encoding || 'utf-8';
  const bufferSize = options.bufferSize || 65536;
  const handle = await open(filePath, 'r');
  const readStream = handle.createReadStream({ highWaterMark: bufferSize });
  try {
    for await (const line of decodeLines(readStream, fallbackEncoding)) {
      yield line;
    }
  } finally {
    await handle.close();
  }
}
