# omnibuf-es

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![OmniBuf Spec: v1 DRAFT-1](https://img.shields.io/badge/OmniBuf%20Spec-v1%20DRAFT--1-FF4F18)](https://omnibuf.com/spec)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

TypeScript and JavaScript implementation of the [OmniBuf v1 DRAFT-1 wire specification](https://omnibuf.com/spec). Documentation and benchmarks live at [omnibuf.com/es](https://omnibuf.com/es).

## Install

```bash
npm install @omnibuf/core
```

For runtime-specific stream framing and string codecs, install `@omnibuf/node` or `@omnibuf/web`.

## Quick Usage

```ts
import { defineMessage, create, toBinary, fromBinary, type Message } from '@omnibuf/core';

interface Peer extends Message<'app.Peer'> {
  peerId: number;
  ipAddress: string;
  active: boolean;
}

const PeerSchema = defineMessage<Peer, 'app.Peer'>('app.Peer', {
  peerId: { fieldNum: 1, name: 'peer_id', type: 'uint32' },
  ipAddress: { fieldNum: 2, name: 'ip_address', type: 'string' },
  active: { fieldNum: 3, type: 'bool' },
});

const peer = create(PeerSchema, { peerId: 42, ipAddress: '10.0.1.42', active: true });
const packet = toBinary(PeerSchema, peer, { selfDescribing: true });
const decoded = fromBinary(PeerSchema, packet);
```

## gRPC & Connect RPC

Two separate detached packages integrate OmniBuf with gRPC and Connect while keeping `@omnibuf/core` free of RPC dependencies:

- **`@omnibuf/grpc`:** `@grpc/grpc-js` marshallers (`createGrpcMarshallers`) and full method definitions (`createGrpcMethodDefinition`).
- **`@omnibuf/connect`:** `@connectrpc/connect/protocol` binary codec (`createConnectCodec`).

```ts
// @grpc/grpc-js
import { createGrpcMethodDefinition } from '@omnibuf/grpc';
const pingMethod = createGrpcMethodDefinition('/pkg.PingService/Ping', {
  request: PingReqSchema,
  response: PingResSchema,
});

// @connectrpc/connect
import { createConnectCodec } from '@omnibuf/connect';
const codec = createConnectCodec({ schema: PeerSchema });
```

## Implementation Details

- **Packages**: `@omnibuf/core` holds the wire codec and schema runtime; `@omnibuf/node` adds Node stream framing, `Buffer` string codecs, and descriptor loaders; `@omnibuf/web` adds Web Streams framing and `TextEncoder` helpers.
- **`@bufbuild/protobuf` v2 interop**: Messages follow the plain-object `Message<TypeName>` layout with `create`, `toBinary`, `fromBinary`, `mergeFromBinary`, `clone`, `equals`, and `DescMessage` descriptor support.
- **Native schemas**: `defineMessage` and `@omnibufMessage` / `@omnibufField` decorators define codecs directly in TypeScript.
- **Codegen**: `@omnibuf/protoc-gen-omnibuf-es` generates typed schemas, single-pass encoders/decoders, and lazy `Opaque` views backed by `spliceFields`.
- **Blind decode**: `decodeBlind` and `decodeBlindJson` inspect self-describing `Field #0` packets.

## Development

```bash
just install && just build && just test && just conformance
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
