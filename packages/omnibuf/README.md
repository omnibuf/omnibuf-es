# @omnibuf/core

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
