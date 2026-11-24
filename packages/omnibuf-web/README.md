# @omnibuf/web

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
