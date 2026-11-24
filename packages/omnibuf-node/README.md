# @omnibuf/node

Node.js runtime helpers for OmniBuf: `Buffer`-backed string codecs, length-prefixed stream framing, file I/O helpers, and binary `FileDescriptorSet` loaders.

## Install

```bash
pnpm add @omnibuf/node
```

## Usage

```ts
import {
  createFrameDecoderStream,
  createFrameEncoderStream,
  encodeFrame,
  readPacketFile,
  writePacketFile,
} from '@omnibuf/node';

// Write and read an OmniBuf packet on disk
await writePacketFile('event.obuf', packetBytes);
const loaded = await readPacketFile('event.obuf');

// Length-prefixed stream framing over Node.js Transform streams
const encoder = createFrameEncoderStream();
const decoder = createFrameDecoderStream({ maxFrameBytes: 4 * 1024 * 1024 });
encoder.pipe(decoder);
encoder.write(loaded);
```
