# @omnibuf/web

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

Browser and Web-standards runtime helpers for OmniBuf: Web Streams framing, `Blob` and `Response` conversions, hex/base64/data-URL utilities, and packet inspection.

## Install

```bash
pnpm add @omnibuf/web
```

## Usage

```ts
import { fromResponse, inspectPacket, toBlob } from '@omnibuf/web';

// Fetch and inspect an OmniBuf binary response
const res = await fetch('/api/event', {
  headers: { Accept: 'application/x-omnibuf' },
});
const packet = await fromResponse(res);
const inspection = inspectPacket(packet);

// Wrap raw OmniBuf bytes as a Blob
const blob = toBlob(packet);
```

## License

Apache-2.0. See [LICENSE](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE).
