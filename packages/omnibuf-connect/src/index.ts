import { Code, ConnectError } from '@connectrpc/connect';
import {
  assertByteStreamRequest,
  contentTypeMatcher,
  createAsyncIterable,
  limitSerialization,
  readAllBytes,
  uResponseMethodNotAllowed,
  uResponseOk,
  uResponseUnsupportedMediaType,
  type Serialization,
  type UniversalClientFn,
  type UniversalServerRequest,
  type UniversalServerResponse,
} from '@connectrpc/connect/protocol';
import {
  fromBinary,
  toBinary,
  type BinaryReadOptions,
  type BinaryWriteOptions,
  type SchemaInput,
} from '@omnibuf/core';

/** Wire codec name for compact OmniBuf Connect payloads. */
export const CODEC_NAME = 'omnibuf';

/** Wire codec name for self-describing OmniBuf Connect payloads carrying Field #0 inline. */
export const SELF_DESCRIBING_CODEC_NAME = 'x-omnibuf';

/** Connect unary Content-Type header value for compact OmniBuf payloads. */
export const CONTENT_TYPE_CONNECT = 'application/omnibuf';

/** Connect unary Content-Type header value for self-describing OmniBuf payloads. */
export const CONTENT_TYPE_CONNECT_SELF_DESCRIBING = 'application/x-omnibuf';

/**
 * Options configuring an OmniBuf `@connectrpc/connect` codec.
 */
export interface ConnectCodecOptions<T extends object = Record<string, unknown>> {
  /** Message schema bound to the codec. */
  schema: SchemaInput<T>;
  /** Emit Field #0 (SchemaMeta) inline in serialized payloads. */
  selfDescribing?: boolean;
  /** Sort map keys deterministically during serialization. */
  deterministic?: boolean;
  /** Override the codec name (defaults to `'x-omnibuf'` when `selfDescribing` is true, else `'omnibuf'`). */
  name?: string;
  /** Additional binary write options forwarded to `toBinary`. */
  writeOptions?: BinaryWriteOptions;
  /** Additional binary read options forwarded to `fromBinary`. */
  readOptions?: BinaryReadOptions;
  /** Optional Connect I/O byte limits enforced via `limitSerialization`. */
  readMaxBytes?: number;
  writeMaxBytes?: number;
}

/**
 * Typed `@connectrpc/connect/protocol` `Serialization<T>` codec backed by OmniBuf.
 */
export interface OmniBufConnectCodec<T extends object> extends Serialization<T> {
  readonly name: string;
  readonly binary: true;
  readonly contentType: string;
  serialize(message: T): Uint8Array<ArrayBuffer>;
  parse(data: Uint8Array): T;
}

/**
 * Options for `createConnectUnaryHandler`.
 */
export interface ConnectUnaryHandlerOptions<Req extends object, Res extends object> {
  readonly requestSchema: SchemaInput<Req>;
  readonly responseSchema: SchemaInput<Res>;
  readonly readMaxBytes?: number;
  readonly writeMaxBytes?: number;
  readonly deterministic?: boolean;
  readonly writeOptions?: BinaryWriteOptions;
  readonly readOptions?: BinaryReadOptions;
}

/**
 * Options for `createConnectUnaryClient`.
 */
export interface ConnectUnaryClientOptions<Req extends object, Res extends object> {
  readonly url: string;
  readonly requestSchema: SchemaInput<Req>;
  readonly responseSchema: SchemaInput<Res>;
  readonly selfDescribing?: boolean;
  readonly deterministic?: boolean;
  readonly readMaxBytes?: number;
  readonly writeMaxBytes?: number;
  readonly writeOptions?: BinaryWriteOptions;
  readonly readOptions?: BinaryReadOptions;
  readonly universalClient: UniversalClientFn;
}

const DEFAULT_MAX_BYTES = 0xffffffff;

function buildWriteOptions(opts: {
  selfDescribing?: boolean;
  deterministic?: boolean;
  writeOptions?: BinaryWriteOptions;
}): BinaryWriteOptions | undefined {
  const hasFlag = opts.selfDescribing !== undefined || opts.deterministic !== undefined;
  if (!hasFlag && !opts.writeOptions) {
    return undefined;
  }
  return {
    ...opts.writeOptions,
    ...(opts.selfDescribing !== undefined ? { selfDescribing: opts.selfDescribing } : {}),
    ...(opts.deterministic !== undefined ? { deterministic: opts.deterministic } : {}),
  };
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

/**
 * Creates a `@connectrpc/connect/protocol` `Serialization<T>` codec backed by OmniBuf.
 */
export function createConnectCodec<T extends object>(
  opts: ConnectCodecOptions<T>,
): OmniBufConnectCodec<T> {
  const writeOptions = buildWriteOptions(opts);
  const readOptions = opts.readOptions;
  const selfDescribing = writeOptions?.selfDescribing ?? false;
  const name = opts.name ?? (selfDescribing ? SELF_DESCRIBING_CODEC_NAME : CODEC_NAME);
  const contentType = `application/${name}`;
  const schema = opts.schema;

  let base: Serialization<T> = {
    serialize(message: T): Uint8Array<ArrayBuffer> {
      try {
        return toArrayBufferView(toBinary(schema, message, writeOptions));
      } catch (e) {
        throw ConnectError.from(e, Code.Internal);
      }
    },
    parse(data: Uint8Array): T {
      try {
        return fromBinary(schema, data, readOptions);
      } catch (e) {
        throw ConnectError.from(e, Code.InvalidArgument);
      }
    },
  };

  if (opts.readMaxBytes !== undefined || opts.writeMaxBytes !== undefined) {
    base = limitSerialization(base, {
      readMaxBytes: opts.readMaxBytes ?? DEFAULT_MAX_BYTES,
      writeMaxBytes: opts.writeMaxBytes ?? DEFAULT_MAX_BYTES,
    });
  }

  return {
    name,
    binary: true,
    contentType,
    serialize: base.serialize,
    parse: base.parse,
  };
}

const omnibufContentTypeRegExp = /^application\/(x-)?omnibuf(?:\s*;.*)?$/;
const matchOmniBufContentType = contentTypeMatcher(omnibufContentTypeRegExp);

/**
 * Creates a `@connectrpc/connect/protocol` universal unary handler that accepts both
 * `application/omnibuf` (compact) and `application/x-omnibuf` (self-describing) requests.
 */
export function createConnectUnaryHandler<Req extends object, Res extends object>(
  options: ConnectUnaryHandlerOptions<Req, Res>,
  impl: (req: Req, requestHeaders: Headers) => Res | Promise<Res>,
): (req: UniversalServerRequest) => Promise<UniversalServerResponse> {
  const compactReqCodec = createConnectCodec({
    schema: options.requestSchema,
    selfDescribing: false,
    readMaxBytes: options.readMaxBytes,
    writeMaxBytes: options.writeMaxBytes,
    readOptions: options.readOptions,
  });
  const compactResCodec = createConnectCodec({
    schema: options.responseSchema,
    selfDescribing: false,
    deterministic: options.deterministic,
    readMaxBytes: options.readMaxBytes,
    writeMaxBytes: options.writeMaxBytes,
    writeOptions: options.writeOptions,
  });
  const selfDescribingResCodec = createConnectCodec({
    schema: options.responseSchema,
    selfDescribing: true,
    deterministic: options.deterministic,
    readMaxBytes: options.readMaxBytes,
    writeMaxBytes: options.writeMaxBytes,
    writeOptions: options.writeOptions,
  });

  return async (req: UniversalServerRequest): Promise<UniversalServerResponse> => {
    if (req.method !== 'POST') {
      return uResponseMethodNotAllowed;
    }
    const ct = req.header.get('content-type') ?? '';
    if (!matchOmniBufContentType(ct)) {
      return uResponseUnsupportedMediaType;
    }
    const isSelfDescribing = ct.startsWith(CONTENT_TYPE_CONNECT_SELF_DESCRIBING);
    assertByteStreamRequest(req);
    const bodyBytes = await readAllBytes(req.body, options.readMaxBytes ?? DEFAULT_MAX_BYTES);

    const requestMsg = compactReqCodec.parse(bodyBytes);
    const responseMsg = await impl(requestMsg, req.header);
    const resCodec = isSelfDescribing ? selfDescribingResCodec : compactResCodec;
    const responseBytes = resCodec.serialize(responseMsg);

    return {
      ...uResponseOk,
      header: new Headers({
        'content-type': resCodec.contentType,
      }),
      body: createAsyncIterable([responseBytes]),
    };
  };
}

/**
 * Creates a Connect unary client function backed by `@connectrpc/connect/protocol`
 * `UniversalClientFn` and OmniBuf codecs.
 */
export function createConnectUnaryClient<Req extends object, Res extends object>(
  options: ConnectUnaryClientOptions<Req, Res>,
): (req: Req, headers?: HeadersInit) => Promise<{ message: Res; header: Headers }> {
  const reqCodec = createConnectCodec({
    schema: options.requestSchema,
    selfDescribing: options.selfDescribing,
    deterministic: options.deterministic,
    readMaxBytes: options.readMaxBytes,
    writeMaxBytes: options.writeMaxBytes,
    writeOptions: options.writeOptions,
  });
  const resCodec = createConnectCodec({
    schema: options.responseSchema,
    selfDescribing: options.selfDescribing,
    readMaxBytes: options.readMaxBytes,
    writeMaxBytes: options.writeMaxBytes,
    readOptions: options.readOptions,
  });

  return async (req: Req, headers?: HeadersInit) => {
    const reqHeaders = new Headers(headers);
    reqHeaders.set('content-type', reqCodec.contentType);
    reqHeaders.set('connect-protocol-version', '1');

    const payload = reqCodec.serialize(req);
    const res = await options.universalClient({
      url: options.url,
      method: 'POST',
      header: reqHeaders,
      body: createAsyncIterable([payload]),
    });

    if (res.status !== 200) {
      throw new ConnectError(`unexpected Connect HTTP status ${res.status}`, Code.Unknown);
    }

    const resBytes = await readAllBytes(res.body, options.readMaxBytes ?? DEFAULT_MAX_BYTES);
    const message = resCodec.parse(resBytes);
    return { message, header: res.header };
  };
}
