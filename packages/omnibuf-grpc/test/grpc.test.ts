import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as grpc from '@grpc/grpc-js';
import { create, decodeBlind, defineMessage, type Message } from '@omnibuf/core';

import {
  CODEC_NAME,
  CONTENT_TYPE_GRPC,
  SELF_DESCRIBING_CODEC_NAME,
  createGrpcMarshallers,
  createGrpcMethodDefinition,
} from '../src/index.js';

interface PingRequest extends Message<'grpc.PingRequest'> {
  asn: number;
  routerId: string;
  tags: Record<string, string>;
}

interface PingResponse extends Message<'grpc.PingResponse'> {
  ok: boolean;
  message: string;
  asn: number;
}

const PingRequestSchema = defineMessage<PingRequest, 'grpc.PingRequest'>('grpc.PingRequest', {
  asn: { fieldNum: 1, name: 'asn', type: 'uint32' },
  routerId: { fieldNum: 2, name: 'router_id', type: 'string' },
  tags: { fieldNum: 3, name: 'tags', type: 'map', mapKey: 'string', mapVal: 'string' },
});

const PingResponseSchema = defineMessage<PingResponse, 'grpc.PingResponse'>('grpc.PingResponse', {
  ok: { fieldNum: 1, name: 'ok', type: 'bool' },
  message: { fieldNum: 2, name: 'message', type: 'string' },
  asn: { fieldNum: 3, name: 'asn', type: 'uint32' },
});

interface PingClient extends grpc.Client {
  ping(
    request: PingRequest,
    callback: (err: grpc.ServiceError | null, response: PingResponse) => void,
  ): grpc.ClientUnaryCall;
}

async function runUnaryRoundTrip(selfDescribing: boolean): Promise<void> {
  const pingMethod = createGrpcMethodDefinition(
    '/omnibuf.test.v1.PingService/Ping',
    { request: PingRequestSchema, response: PingResponseSchema },
    { selfDescribing, deterministic: true, originalName: 'ping' },
  );
  const serviceDef: grpc.ServiceDefinition = { ping: pingMethod };

  const server = new grpc.Server();
  server.addService(serviceDef, {
    ping(
      call: grpc.ServerUnaryCall<PingRequest, PingResponse>,
      callback: grpc.sendUnaryData<PingResponse>,
    ) {
      const req = call.request;
      callback(
        null,
        create(PingResponseSchema, {
          ok: true,
          message: `pong:${req.routerId}`,
          asn: req.asn,
        }),
      );
    },
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(boundPort);
    });
  });

  const ClientCtor = grpc.makeGenericClientConstructor(serviceDef, 'PingService');
  const client = new ClientCtor(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure(),
  ) as unknown as PingClient;

  try {
    const req = create(PingRequestSchema, {
      asn: 64512,
      routerId: 'edge-rtr-fra-01',
      tags: { env: 'prod', region: 'eu-central' },
    });

    const res = await new Promise<PingResponse>((resolve, reject) => {
      client.ping(req, (err, response) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });

    assert.equal(res.ok, true);
    assert.equal(res.message, 'pong:edge-rtr-fra-01');
    assert.equal(res.asn, 64512);
  } finally {
    client.close();
    await new Promise<void>((resolve) => {
      server.tryShutdown(() => resolve());
    });
  }
}

describe('@omnibuf/grpc', () => {
  it('exports expected gRPC codec constants', () => {
    assert.equal(CODEC_NAME, 'omnibuf');
    assert.equal(SELF_DESCRIBING_CODEC_NAME, 'x-omnibuf');
    assert.equal(CONTENT_TYPE_GRPC, 'application/grpc+omnibuf');
  });

  it('executes a real @grpc/grpc-js loopback unary RPC in compact mode', async () => {
    await runUnaryRoundTrip(false);
  });

  it('executes a real @grpc/grpc-js loopback unary RPC in self-describing mode', async () => {
    await runUnaryRoundTrip(true);

    const marshallers = createGrpcMarshallers(PingRequestSchema, { selfDescribing: true });
    const req = create(PingRequestSchema, { asn: 65001, routerId: 'core-nyc-02' });
    const buf = marshallers.requestSerialize(req);
    assert.ok(Buffer.isBuffer(buf));
    const blind = decodeBlind(buf) as Record<string, unknown>;
    assert.equal(blind['router_id'], 'core-nyc-02');
  });
});
