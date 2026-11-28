# @omnibuf/core

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

Core TypeScript implementation of the OmniBuf binary wire format: 16 explicit wire types, 1/2/4/9-byte Prefix-Varints, lazy `Opaque` header-hop views, declarative schemas, `@bufbuild/protobuf` bridges, and blind decoding.

## Install

```bash
pnpm add @omnibuf/core
```

## Usage

```ts
import { decodeBlind, fromBinary, schema, toBinary } from '@omnibuf/core';

const UserSchema = schema({
  1: ['id', 'uint64'],
  2: ['name', 'string'],
  3: ['active', 'bool'],
});

const bytes = toBinary(UserSchema, { id: 42n, name: 'Ada', active: true });
const user = fromBinary(UserSchema, bytes);

// Self-describing payload with Field #0 metadata
const selfDescribing = toBinary(UserSchema, user, { selfDescribing: true });
const inspected = decodeBlind(selfDescribing);
```

## License

Apache-2.0. See [LICENSE](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE).
