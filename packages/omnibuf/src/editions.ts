import {
  ProtoScalarType,
  parseFieldDescriptorType,
  type DescriptorProtoJSON,
  type EditionFeatures,
  type EnumDescriptorProtoJSON,
  type FileDescriptorProtoJSON,
} from './protobuf-es.js';

const SUPPORTED_EDITIONS = new Set<number | string>([
  1000,
  1001,
  1002,
  'EDITION_2023',
  'EDITION_2024',
  'EDITION_2026',
]);

const LEGACY_SYNTAX_EDITIONS = new Set<number | string>([
  0,
  998,
  999,
  'EDITION_UNKNOWN',
  'EDITION_PROTO2',
  'EDITION_PROTO3',
]);

/** Returns true when `edition` is one of the supported Protobuf Editions (2023, 2024, 2026). */
export function isSupportedEdition(edition: number | string | undefined): boolean {
  return edition !== undefined && SUPPORTED_EDITIONS.has(edition);
}

/** Returns true when an extension extends a `google.protobuf.*Options` descriptor message. */
export function isDescriptorOptionExtension(ext: { extendee?: string } | undefined): boolean {
  if (!ext?.extendee) return false;
  const clean = ext.extendee.replace(/^\./, '');
  return /^google\.protobuf\.[A-Za-z0-9_]+Options$/.test(clean);
}

function isUnsetFeature(v: number | string | undefined): boolean {
  return (
    v === undefined || v === 0 || v === '' || (typeof v === 'string' && v.endsWith('_UNKNOWN'))
  );
}

/** Merge child Edition features over parent features, ignoring unset (`0` / `*_UNKNOWN`) values. */
export function mergeEditionFeatures(
  parent: EditionFeatures,
  child?: EditionFeatures,
): EditionFeatures {
  if (!child) return parent;
  const merged: EditionFeatures = { ...parent };
  if (!isUnsetFeature(child.fieldPresence)) merged.fieldPresence = child.fieldPresence;
  if (!isUnsetFeature(child.enumType)) merged.enumType = child.enumType;
  if (!isUnsetFeature(child.repeatedFieldEncoding)) {
    merged.repeatedFieldEncoding = child.repeatedFieldEncoding;
  }
  if (!isUnsetFeature(child.utf8Validation)) merged.utf8Validation = child.utf8Validation;
  if (!isUnsetFeature(child.messageEncoding)) merged.messageEncoding = child.messageEncoding;
  if (!isUnsetFeature(child.jsonFormat)) merged.jsonFormat = child.jsonFormat;
  if (!isUnsetFeature(child.enforceNamingStyle)) {
    merged.enforceNamingStyle = child.enforceNamingStyle;
  }
  if (!isUnsetFeature(child.defaultSymbolVisibility)) {
    merged.defaultSymbolVisibility = child.defaultSymbolVisibility;
  }
  if (!isUnsetFeature(child.enforceProtoLimits)) {
    merged.enforceProtoLimits = child.enforceProtoLimits;
  }
  return merged;
}

function isOpenEnumFeature(v: number | string | undefined): boolean {
  return v === 1 || v === 'OPEN';
}

function isExplicitPresenceFeature(v: number | string | undefined): boolean {
  return v === 1 || v === 'EXPLICIT';
}

function isAllowedPresenceFeature(v: number | string | undefined): boolean {
  return v === 1 || v === 2 || v === 'EXPLICIT' || v === 'IMPLICIT';
}

function isLegacyRequiredFeature(v: number | string | undefined): boolean {
  return v === 3 || v === 'LEGACY_REQUIRED';
}

function isUtf8VerifyFeature(v: number | string | undefined): boolean {
  return v === 2 || v === 'VERIFY';
}

function isEditionsDescriptorFile(file: FileDescriptorProtoJSON): boolean {
  if (file.syntax === 'editions') return true;
  if (file.edition !== undefined && !LEGACY_SYNTAX_EDITIONS.has(file.edition)) {
    return true;
  }
  return false;
}

/** Returns true if a text-format `defaultValue` from `FieldDescriptorProto` represents the zero default. */
export function isZeroDefaultString(
  typeNum: number,
  defaultValue: string,
  enumZeroNames?: ReadonlySet<string>,
): boolean {
  if (defaultValue === '') return true;
  switch (typeNum) {
    case ProtoScalarType.STRING:
    case ProtoScalarType.BYTES:
      return defaultValue === '';
    case ProtoScalarType.BOOL:
      return defaultValue === 'false';
    case ProtoScalarType.FLOAT:
    case ProtoScalarType.DOUBLE: {
      const trimmed = defaultValue.trim();
      if (trimmed === '') return true;
      const num = Number(trimmed);
      return Number.isFinite(num) && Object.is(num, 0);
    }
    case ProtoScalarType.INT32:
    case ProtoScalarType.INT64:
    case ProtoScalarType.UINT32:
    case ProtoScalarType.UINT64:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.SINT64:
    case ProtoScalarType.FIXED32:
    case ProtoScalarType.FIXED64:
    case ProtoScalarType.SFIXED32:
    case ProtoScalarType.SFIXED64: {
      const trimmed = defaultValue.trim();
      if (trimmed === '') return true;
      const normalized = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
      try {
        return BigInt(normalized) === 0n;
      } catch {
        return false;
      }
    }
    case ProtoScalarType.ENUM: {
      const trimmed = defaultValue.trim();
      if (trimmed === '' || trimmed === '0') return true;
      return Boolean(enumZeroNames?.has(trimmed));
    }
    default:
      return false;
  }
}

/** Returns true if a decoded default value (from `@bufbuild/protobuf` `DescField.getDefaultValue()`) is zero. */
export function isZeroDecodedDefaultValue(typeNum: number, val: unknown): boolean {
  if (val === undefined) return true;
  switch (typeNum) {
    case ProtoScalarType.STRING:
      return val === '';
    case ProtoScalarType.BYTES:
      return val instanceof Uint8Array && val.byteLength === 0;
    case ProtoScalarType.BOOL:
      return val === false;
    case ProtoScalarType.FLOAT:
    case ProtoScalarType.DOUBLE:
      return typeof val === 'number' && Number.isFinite(val) && Object.is(val, 0);
    case ProtoScalarType.ENUM:
      return val === 0;
    case ProtoScalarType.INT32:
    case ProtoScalarType.INT64:
    case ProtoScalarType.UINT32:
    case ProtoScalarType.UINT64:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.SINT64:
    case ProtoScalarType.FIXED32:
    case ProtoScalarType.FIXED64:
    case ProtoScalarType.SFIXED32:
    case ProtoScalarType.SFIXED64:
      if (typeof val === 'bigint') return val === 0n;
      if (typeof val === 'number') return val === 0;
      if (typeof val === 'string') return isZeroDefaultString(typeNum, val);
      return false;
    default:
      return false;
  }
}

interface EnumMeta {
  open: boolean;
  zeroNames: Set<string>;
}

const EDITION_BASE_FEATURES: EditionFeatures = {
  fieldPresence: 1,
  enumType: 1,
  repeatedFieldEncoding: 1,
  utf8Validation: 2,
  messageEncoding: 1,
  jsonFormat: 1,
};

function buildEnumMetaMap(files: readonly FileDescriptorProtoJSON[]): Map<string, EnumMeta> {
  const map = new Map<string, EnumMeta>();
  for (const file of files) {
    const pkg = file.package ?? '';
    const isEditions = isEditionsDescriptorFile(file);
    const baseFeatures: EditionFeatures = isEditions
      ? mergeEditionFeatures(EDITION_BASE_FEATURES, file.options?.features)
      : { enumType: file.syntax === 'proto3' ? 1 : 2 };

    const recordEnum = (
      prefix: string,
      en: EnumDescriptorProtoJSON,
      parentFeatures: EditionFeatures,
    ): void => {
      const fullName = prefix ? `${prefix}.${en.name ?? ''}` : (en.name ?? '');
      const resolved = isEditions
        ? mergeEditionFeatures(parentFeatures, en.options?.features)
        : parentFeatures;
      const zeroNames = new Set<string>();
      for (const v of en.value ?? []) {
        if (v.number === 0 && v.name) {
          zeroNames.add(v.name);
        }
      }
      map.set(fullName, {
        open: isOpenEnumFeature(resolved.enumType),
        zeroNames,
      });
    };

    const visitMsg = (
      prefix: string,
      msg: DescriptorProtoJSON,
      parentFeatures: EditionFeatures,
    ): void => {
      const fullName = prefix ? `${prefix}.${msg.name ?? ''}` : (msg.name ?? '');
      const msgFeatures = isEditions
        ? mergeEditionFeatures(parentFeatures, msg.options?.features)
        : parentFeatures;
      for (const en of msg.enumType ?? []) {
        recordEnum(fullName, en, msgFeatures);
      }
      for (const nested of msg.nestedType ?? []) {
        visitMsg(fullName, nested, msgFeatures);
      }
    };

    for (const en of file.enumType ?? []) {
      recordEnum(pkg, en, baseFeatures);
    }
    for (const msg of file.messageType ?? []) {
      visitMsg(pkg, msg, baseFeatures);
    }
  }
  return map;
}

function resolveEnumMeta(
  rawTypeName: string | undefined,
  enclosingFullName: string,
  pkg: string,
  enumMap: Map<string, EnumMeta>,
): EnumMeta | undefined {
  if (!rawTypeName) return undefined;
  if (rawTypeName.startsWith('.')) {
    return enumMap.get(rawTypeName.slice(1));
  }
  const parts = enclosingFullName ? enclosingFullName.split('.') : [];
  for (let i = parts.length; i >= 0; i--) {
    const scope = parts.slice(0, i).join('.');
    const candidate = scope ? `${scope}.${rawTypeName}` : rawTypeName;
    const hit = enumMap.get(candidate);
    if (hit) return hit;
  }
  if (pkg) {
    const hit = enumMap.get(`${pkg}.${rawTypeName}`);
    if (hit) return hit;
  }
  return enumMap.get(rawTypeName);
}

/** Resolve inherited edition features into the codec's explicit-presence model. */
export function resolveEditionFile(
  file: FileDescriptorProtoJSON,
  allFiles?: readonly FileDescriptorProtoJSON[],
): FileDescriptorProtoJSON {
  if (!isEditionsDescriptorFile(file)) return file;
  const fileLabel = file.name ?? 'unknown';
  if (!isSupportedEdition(file.edition)) {
    throw new Error(`omnibuf: unsupported protobuf edition ${String(file.edition)} (${fileLabel})`);
  }

  for (const ext of file.extension ?? []) {
    if (!isDescriptorOptionExtension(ext)) {
      throw new Error(
        `omnibuf: editions extensions are not supported (${fileLabel}.${ext.name ?? 'extension'})`,
      );
    }
  }

  const enumMap = buildEnumMetaMap(allFiles && allFiles.length > 0 ? allFiles : [file]);
  const result = structuredClone(file);
  const pkg = result.package ?? '';
  const base = mergeEditionFeatures(EDITION_BASE_FEATURES, result.options?.features);

  const checkEnum = (e: EnumDescriptorProtoJSON, parent: EditionFeatures, scope: string): void => {
    const features = mergeEditionFeatures(parent, e.options?.features);
    if (!isOpenEnumFeature(features.enumType)) {
      const target = scope ? `${scope}.${e.name ?? ''}` : (e.name ?? '');
      throw new Error(`omnibuf: editions CLOSED enums are not supported (${target})`);
    }
  };

  const visit = (
    m: DescriptorProtoJSON,
    parent: EditionFeatures,
    enclosingScope: string,
    mapFieldFeatures?: EditionFeatures,
  ): void => {
    const fullName = enclosingScope ? `${enclosingScope}.${m.name ?? ''}` : (m.name ?? '');
    for (const ext of m.extension ?? []) {
      if (!isDescriptorOptionExtension(ext)) {
        throw new Error(
          `omnibuf: editions extensions are not supported (${fullName}.${ext.name ?? 'extension'})`,
        );
      }
    }
    const features = mergeEditionFeatures(
      mergeEditionFeatures(parent, m.options?.features),
      mapFieldFeatures,
    );
    for (const e of m.enumType ?? []) checkEnum(e, features, fullName);

    const isMapEntry = Boolean(m.options?.mapEntry);
    const mapFieldOverrides = new Map<DescriptorProtoJSON, EditionFeatures>();

    for (const f of m.field ?? []) {
      const oneof = f.oneofIndex === undefined ? undefined : m.oneofDecl?.[f.oneofIndex];
      const resolved = mergeEditionFeatures(
        mergeEditionFeatures(features, oneof?.options?.features),
        f.options?.features,
      );
      const repeated = f.label === 3 || f.label === 'LABEL_REPEATED';
      const fieldLabel = `${fullName}.${f.name ?? ''}`;

      if (
        f.label === 2 ||
        f.label === 'LABEL_REQUIRED' ||
        isLegacyRequiredFeature(f.options?.features?.fieldPresence) ||
        isLegacyRequiredFeature(oneof?.options?.features?.fieldPresence) ||
        (!repeated && !isMapEntry && !isAllowedPresenceFeature(resolved.fieldPresence))
      ) {
        throw new Error(
          `omnibuf: editions LEGACY_REQUIRED fields are not supported (${fieldLabel})`,
        );
      }

      const typeNum = f.type !== undefined ? parseFieldDescriptorType(f.type) : undefined;

      // OmniBuf strings always use strict UTF-8; accepting NONE would lose protobuf values.
      if (typeNum === ProtoScalarType.STRING && !isUtf8VerifyFeature(resolved.utf8Validation)) {
        throw new Error(`omnibuf: editions UTF-8 NONE is not supported (${fieldLabel})`);
      }

      if (typeNum === ProtoScalarType.ENUM) {
        const enumMeta = resolveEnumMeta(f.typeName, fullName, pkg, enumMap);
        if (enumMeta && !enumMeta.open) {
          throw new Error(
            `omnibuf: editions CLOSED enums are not supported (${fieldLabel} -> ${f.typeName ?? ''})`,
          );
        }
      }

      if (typeNum !== undefined && f.defaultValue !== undefined && f.defaultValue !== '') {
        const enumMeta =
          typeNum === ProtoScalarType.ENUM
            ? resolveEnumMeta(f.typeName, fullName, pkg, enumMap)
            : undefined;
        if (!isZeroDefaultString(typeNum, f.defaultValue, enumMeta?.zeroNames)) {
          throw new Error(
            `omnibuf: editions custom non-zero default value "${f.defaultValue}" is not supported (${fieldLabel})`,
          );
        }
      }

      // Message framing is supplied by OmniBuf, independent of LENGTH_PREFIXED vs DELIMITED.
      if (typeNum === ProtoScalarType.GROUP) {
        f.type = ProtoScalarType.MESSAGE;
      }

      if (typeNum === ProtoScalarType.MESSAGE && f.options?.features && m.nestedType?.length) {
        const cleanTarget = (f.typeName ?? '').replace(/^\./, '');
        const matchedMapEntry = m.nestedType.find(
          (nt) =>
            nt.options?.mapEntry &&
            (cleanTarget === `${fullName}.${nt.name ?? ''}` ||
              cleanTarget === `${m.name ?? ''}.${nt.name ?? ''}` ||
              cleanTarget === (nt.name ?? '')),
        );
        if (matchedMapEntry) {
          mapFieldOverrides.set(matchedMapEntry, f.options.features);
        }
      }

      if (f.oneofIndex === undefined && !repeated && !isMapEntry) {
        f.proto3Optional = isExplicitPresenceFeature(resolved.fieldPresence);
      }
    }

    for (const nested of m.nestedType ?? []) {
      visit(nested, features, fullName, mapFieldOverrides.get(nested));
    }
  };

  for (const e of result.enumType ?? []) checkEnum(e, base, pkg);
  for (const m of result.messageType ?? []) visit(m, base, pkg);
  // This is an internal codec model, never a descriptor sent back to protobuf.
  result.syntax = 'proto3';
  return result;
}

/** Resolve all files in a descriptor set, preserving cross-file enum visibility during validation. */
export function resolveEditionFiles(
  files: readonly FileDescriptorProtoJSON[],
): FileDescriptorProtoJSON[] {
  return files.map((file) => resolveEditionFile(file, files));
}
