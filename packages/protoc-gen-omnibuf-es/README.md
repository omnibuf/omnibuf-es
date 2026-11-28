# @omnibuf/protoc-gen-omnibuf-es

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

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

## License

Apache-2.0. See [LICENSE](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE).
