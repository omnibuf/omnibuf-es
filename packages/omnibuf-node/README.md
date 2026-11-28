# @omnibuf/node

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

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

## License

Apache-2.0. See [LICENSE](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE).
