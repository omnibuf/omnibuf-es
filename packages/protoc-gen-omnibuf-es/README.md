# @omnibuf/protoc-gen-omnibuf-es

Protocol Buffers compiler plugin generating TypeScript single-pass OmniBuf encoders, switch decoders, and lazy `Opaque<T>` views.

## Install

```bash
pnpm add -D @omnibuf/protoc-gen-omnibuf-es
pnpm add @omnibuf/core
```

## Usage

Configure `buf.gen.yaml`:

```yaml
version: v2
plugins:
  - local: protoc-gen-omnibuf-es
    out: src/gen
```

Generate TypeScript codecs:

```bash
buf generate
```

Then import the generated encoder, decoder, and lazy `Opaque` view:

```ts
import { OpaqueUser, decodeUser, encodeUser } from './gen/user_omnibuf.pb.js';

const bytes = encodeUser({ id: 42n, name: 'Ada', active: true });
const user = decodeUser(bytes);

// Header-hop directly to a single field without decoding the full message
const view = new OpaqueUser(bytes);
const name = view.getName();
```
