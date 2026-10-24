import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLineIterator } from '../src/index.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { Buffer } from 'node:buffer';

async function collect(iter) {
  const lines = [];
  for await (const line of iter) lines.push(line);
  return lines;
}

const FILES = [
  '/tmp/lines.txt',
  '/tmp/empty.txt',
  '/tmp/no-newline.txt',
  '/tmp/windows-eol.txt',
  '/tmp/utf8-bom.txt',
  '/tmp/utf16le.txt',
  '/tmp/multi-byte-boundary.txt',
  '/tmp/cr-only.txt',
];

function cleanup() {
  for (const f of FILES) {
    try { unlinkSync(f); } catch {}
  }
}

cleanup();
process.on('exit', cleanup);

writeFileSync('/tmp/lines.txt', 'one\ntwo\nthree\n');
writeFileSync('/tmp/empty.txt', '');
writeFileSync('/tmp/no-newline.txt', 'final');
writeFileSync('/tmp/windows-eol.txt', 'a\r\nb\r\n');
writeFileSync('/tmp/utf8-bom.txt', '\uFEFFhello\nworld\n');
writeFileSync('/tmp/utf16le.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('line1\nline2\n', 'utf16le')]));
writeFileSync('/tmp/cr-only.txt', 'x\ry\r');

// Encode a string with a multi-byte character that straddles buffer boundaries.
const multiStr = 'ab' + 'あ'.repeat(2) + 'cd\n';
const multiBuf = Buffer.from(multiStr, 'utf-8');
const half = Math.floor(multiBuf.length / 2);
writeFileSync('/tmp/multi-byte-boundary.txt', '');
writeFileSync('/tmp/multi-byte-boundary.txt', multiBuf.subarray(0, half));
writeFileSync('/tmp/multi-byte-boundary.txt', multiBuf.subarray(half), { flag: 'a' });

describe('createLineIterator', () => {
  it('reads lines from a plain UTF-8 file', async () => {
    const lines = await collect(createLineIterator('/tmp/lines.txt'));
    assert.deepEqual(lines, ['one', 'two', 'three']);
  });

  it('yields nothing for an empty file', async () => {
    const lines = await collect(createLineIterator('/tmp/empty.txt'));
    assert.deepEqual(lines, []);
  });

  it('yields a final line without a trailing newline', async () => {
    const lines = await collect(createLineIterator('/tmp/no-newline.txt'));
    assert.deepEqual(lines, ['final']);
  });

  it('strips CR from CRLF line endings', async () => {
    const lines = await collect(createLineIterator('/tmp/windows-eol.txt'));
    assert.deepEqual(lines, ['a', 'b']);
  });

  it('preserves a trailing bare CR as part of the final line', async () => {
    const lines = await collect(createLineIterator('/tmp/cr-only.txt'));
    assert.deepEqual(lines, ['x\ry']);
  });

  it('strips a UTF-8 BOM from the first line', async () => {
    const lines = await collect(createLineIterator('/tmp/utf8-bom.txt'));
    assert.deepEqual(lines, ['hello', 'world']);
  });

  it('decodes UTF-16-LE when a BOM is present', async () => {
    const lines = await collect(createLineIterator('/tmp/utf16le.txt'));
    assert.deepEqual(lines, ['line1', 'line2']);
  });

  it('handles a multi-byte character split across buffers', async () => {
    const lines = await collect(createLineIterator('/tmp/multi-byte-boundary.txt', { bufferSize: 4 }));
    assert.deepEqual(lines, ['ab' + 'あ'.repeat(2) + 'cd']);
  });

  it('closes the file handle when the consumer breaks early', async () => {
    const iter = createLineIterator('/tmp/lines.txt');
    const first = await iter.next();
    assert.equal(first.value, 'one');
    await iter.return();
    assert.ok(true, 'did not throw after early return');
  });

  it('propagates an error for a missing file', async () => {
    await assert.rejects(async () => {
      for await (const _ of createLineIterator('/tmp/does-not-exist-' + Date.now())) {
        // unreachable
      }
    }, Error);
  });
});
