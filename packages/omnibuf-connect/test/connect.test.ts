import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Code, ConnectError } from '@connectrpc/connect';
import {
  createFetchHandler,
  readAllBytes,
  universalClientResponseFromFetch,
  type UniversalClientFn,
} from '@connectrpc/connect/protocol';
import { create, decodeBlind, defineMessage, type Message } from '@omnibuf/core';

import {
  CODEC_NAME,
  CONTENT_TYPE_CONNECT,
  CONTENT_TYPE_CONNECT_SELF_DESCRIBING,
  SELF_DESCRIBING_CODEC_NAME,
  createConnectCodec,
  createConnectUnaryClient,
  createConnectUnaryHandler,
} from '../src/index.js';

interface PingRequest extends Message<'connect.PingRequest'> {
  asn: number;
  routerId: string;
  tags: Record<string, string>;
}

interface PingResponse extends Message<'connect.PingResponse'> {
  ok: boolean;
  message: string;
  asn: number;
}

const PingRequestSchema = defineMessage<PingRequest, 'connect.PingRequest'>('connect.PingRequest', {
  asn: { fieldNum: 1, name: 'asn', type: 'uint32' },
  routerId: { fieldNum: 2, name: 'router_id', type: 'string' },
  tags: { fieldNum: 3, name: 'tags', type: 'map', mapKey: 'string', mapVal: 'string' },
});

const PingResponseSchema = defineMessage<PingResponse, 'connect.PingResponse'>(
  'connect.PingResponse',
  {
    ok: { fieldNum: 1, name: 'ok', type: 'bool' },
    message: { fieldNum: 2, name: 'message', type: 'string' },
    asn: { fieldNum: 3, name: 'asn', type: 'uint32' },
  },
);

describe('@omnibuf/connect', () => {
  it('exports expected Connect codec constants', () => {
    assert.equal(CODEC_NAME, 'omnibuf');
    assert.equal(SELF_DESCRIBING_CODEC_NAME, 'x-omnibuf');
    assert.equal(CONTENT_TYPE_CONNECT, 'application/omnibuf');
    assert.equal(CONTENT_TYPE_CONNECT_SELF_DESCRIBING, 'application/x-omnibuf');
  });

  it('executes a real @connectrpc/connect/protocol Fetch unary round-trip in compact and self-describing modes', async () => {
    const handler = createConnectUnaryHandler(
      {
        requestSchema: PingRequestSchema,
        responseSchema: PingResponseSchema,
        deterministic: true,
      },
      (req) =>
        create(PingResponseSchema, {
          ok: true,
          message: `pong:${req.routerId}`,
          asn: req.asn,
        }),
    );

    const fetchHandler = createFetchHandler(handler);

    let lastRequestContentType = '';
    let lastRequestBody: Uint8Array = new Uint8Array();
    let lastProtocolVersion = '';

    const universalClient: UniversalClientFn = async (uReq) => {
      const bodyBytes = uReq.body ? await readAllBytes(uReq.body, 0xffffffff) : new Uint8Array();
      const bodyBuf = new Uint8Array(new ArrayBuffer(bodyBytes.byteLength));
      bodyBuf.set(bodyBytes);
      const fetchReq = new Request(uReq.url, {
        method: uReq.method,
        headers: uReq.header,
        body: bodyBuf,
      });
      lastRequestContentType = fetchReq.headers.get('content-type') ?? '';
      lastProtocolVersion = fetchReq.headers.get('connect-protocol-version') ?? '';
      lastRequestBody = bodyBuf;

      const fetchRes = await fetchHandler(fetchReq);
      return universalClientResponseFromFetch(fetchRes);
    };

    for (const selfDescribing of [false, true]) {
      const callPing = createConnectUnaryClient({
        url: 'https://rpc.example.test/omnibuf.test.v1.PingService/Ping',
        requestSchema: PingRequestSchema,
        responseSchema: PingResponseSchema,
        selfDescribing,
        deterministic: true,
        universalClient,
      });

      const req = create(PingRequestSchema, {
        asn: 64512,
        routerId: 'edge-rtr-fra-01',
        tags: { env: 'prod', region: 'eu-central' },
      });

      const { message, header } = await callPing(req);

      assert.equal(lastProtocolVersion, '1');
      assert.equal(
        lastRequestContentType,
        selfDescribing ? CONTENT_TYPE_CONNECT_SELF_DESCRIBING : CONTENT_TYPE_CONNECT,
      );
      assert.equal(
        header.get('content-type'),
        selfDescribing ? CONTENT_TYPE_CONNECT_SELF_DESCRIBING : CONTENT_TYPE_CONNECT,
      );
      assert.equal(message.ok, true);
      assert.equal(message.message, 'pong:edge-rtr-fra-01');
      assert.equal(message.asn, 64512);

      if (selfDescribing) {
        const blind = decodeBlind(lastRequestBody) as Record<string, unknown>;
        assert.equal(blind['router_id'], 'edge-rtr-fra-01');
      }
    }
  });

  it('enforces readMaxBytes via Connect limitSerialization and throws ConnectError', () => {
    const codec = createConnectCodec({
      schema: PingRequestSchema,
      selfDescribing: true,
      readMaxBytes: 4,
    });
    assert.equal(codec.name, SELF_DESCRIBING_CODEC_NAME);
    assert.equal(codec.binary, true);

    const req = create(PingRequestSchema, { asn: 65001, routerId: 'core-nyc-02' });
    const bytes = codec.serialize(req);
    assert.throws(
      () => codec.parse(bytes),
      (err: unknown) => err instanceof ConnectError && err.code === Code.ResourceExhausted,
    );
  });
});
