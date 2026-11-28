# @omnibuf/grpc

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

OmniBuf marshallers and method definitions for `@grpc/grpc-js`.

## Install

```bash
pnpm add @omnibuf/core @omnibuf/grpc @grpc/grpc-js
```

## Usage

```ts
import * as grpc from '@grpc/grpc-js';
import { createGrpcMethodDefinition } from '@omnibuf/grpc';
import { UserRequestSchema, UserResponseSchema } from './gen/user_omnibuf.pb.js';

const getUserMethod = createGrpcMethodDefinition('/acme.v1.UserService/GetUser', {
  request: UserRequestSchema,
  response: UserResponseSchema,
});

const serviceDef = { getUser: getUserMethod };

// Server
const server = new grpc.Server();
server.addService(serviceDef, {
  getUser(call, callback) {
    callback(null, { id: call.request.id, name: 'Ada' });
  },
});

// Client
const UserClient = grpc.makeGenericClientConstructor(serviceDef, 'UserService');
const client = new UserClient('127.0.0.1:50051', grpc.credentials.createInsecure());
```

Pass `{ selfDescribing: true }` to `createGrpcMethodDefinition` or `createGrpcMarshallers` to emit Field #0 schema metadata inline (`application/grpc+x-omnibuf`).

## License

Apache-2.0. See [LICENSE](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE).
