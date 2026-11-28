# @omnibuf/connect

[![CI](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/omnibuf/omnibuf-es/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-omnibuf.com-111111?style=flat&labelColor=111111&color=D4FF33)](https://omnibuf.com/es)

OmniBuf binary codec and unary helpers for `@connectrpc/connect`.

## Install

```bash
pnpm add @omnibuf/core @omnibuf/connect @connectrpc/connect
```

## Usage

```ts
import {
  createConnectCodec,
  createConnectUnaryClient,
  createConnectUnaryHandler,
} from '@omnibuf/connect';
import { UserRequestSchema, UserResponseSchema } from './gen/user_omnibuf.pb.js';

// Standalone Serialization<T> codec
const userCodec = createConnectCodec({ schema: UserRequestSchema });
const bytes = userCodec.serialize({ id: '42' });
const decoded = userCodec.parse(bytes);

// Connect unary handler accepting application/omnibuf and application/x-omnibuf
const handler = createConnectUnaryHandler(
  { requestSchema: UserRequestSchema, responseSchema: UserResponseSchema },
  async (req) => ({ id: req.id, name: 'Ada' }),
);

// Connect unary client over any UniversalClientFn
const getUser = createConnectUnaryClient({
  url: 'https://api.example.com/acme.v1.UserService/GetUser',
  requestSchema: UserRequestSchema,
  responseSchema: UserResponseSchema,
  universalClient,
});
const { message } = await getUser({ id: '42' });
```

## License

Apache-2.0. See [LICENSE](https://github.com/omnibuf/omnibuf-es/blob/main/LICENSE).
