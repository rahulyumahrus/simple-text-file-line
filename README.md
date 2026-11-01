# simple-text-file-line

Reads a text file line by line as an async iterator, with a configurable read buffer and automatic detection of a leading byte-order mark.

```js
import { createLineIterator } from 'simple-text-file-line';
import { writeFileSync } from 'node:fs';

writeFileSync('./data.txt', 'one\ntwo\nthree\n');

for await (const line of createLineIterator('./data.txt')) {
  console.log(line);
}
```

## Why

Line-by-line file reads in Node usually pull in a third-party package or rely on `readline` which is oriented around interactive streams. For the simple case of scanning a whole file from disk, that is more machinery than is needed. This library wraps `fs/promises.open` with a minimal pre-decoder that detects a BOM, feeds raw bytes through `TextDecoder`, and splits on `\n`.

## Edge cases

- `\r\n` endings are normalised: a trailing `\r` is stripped from each yielded line.
- A bare `\r` that is not followed by `\n` is **not** treated as a line separator. It is preserved in the yielded text. This is a deliberate choice: single-`\r` files are rare and supporting them adds ambiguity for no real gain.
- A UTF-8, UTF-16-LE, or UTF-16-BE BOM at the start of the file is detected and consumed before the first line is yielded. UTF-32 is also detected, though Node's `TextDecoder` support for it varies by platform.
- If no BOM is present, the `encoding` option (default `utf-8`) is used. Pass an explicit value to read legacy single-byte encodings.
- The `bufferSize` option controls the read chunk size. The default of 64 KiB is a reasonable middle ground; smaller values are useful for testing multi-byte character handling but will slow real-world reads.
- When a multi-byte character falls across two read chunks, `TextDecoder`'s streaming mode is used so the partial bytes are held until the remainder arrives.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

