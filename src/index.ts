import { isIP } from "node:net";

export const TARGET_ENVELOPE_VERSION = "1" as const;
export const DEFAULT_SIDECAR_ENDPOINT = "http://127.0.0.1:15001" as const;

export type TargetEnvelopeDiagnostic =
  | "INVALID_UNICODE_SCALAR"
  | "CONTROL_CHARACTER"
  | "REQUIRED_FIELD_EMPTY"
  | "INVALID_ORIGINAL_ENDPOINT";

export class TargetEnvelopeError extends TypeError {
  readonly diagnostic: TargetEnvelopeDiagnostic;

  constructor(diagnostic: TargetEnvelopeDiagnostic, message: string) {
    super(message);
    this.name = "TargetEnvelopeError";
    this.diagnostic = diagnostic;
  }
}

export interface TargetEnvelopeInput {
  readonly namespace: string;
  readonly service: string;
  readonly protocol?: string;
  readonly group?: string;
  readonly serviceVersion?: string;
  readonly method?: string;
  readonly originalEndpoint?: string;
}

export interface TargetEnvelope {
  readonly namespace: string;
  readonly service: string;
  readonly protocol?: string;
  readonly group?: string;
  readonly serviceVersion?: string;
  readonly method?: string;
  readonly originalEndpoint?: string;
}

export type HttpHeaders = Readonly<Record<string, string>>;

type MutableTargetEnvelope = {
  -readonly [FieldName in keyof TargetEnvelope]: TargetEnvelope[FieldName];
};

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const LEADING_OR_TRAILING_WHITESPACE_PATTERN =
  /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu;
const HOST_PORT_PATTERN = /^([^:]+):([0-9]+)$/u;
const IPV6_PORT_PATTERN = /^\[([^\]]+)\]:([0-9]+)$/u;
const INVALID_HOST_CHARACTER_PATTERN =
  /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000%/\\[\]@?#]/u;

const HEADER_FIELDS = [
  ["x-pole-target-namespace", "namespace"],
  ["x-pole-target-service", "service"],
  ["x-pole-target-protocol", "protocol"],
  ["x-pole-target-group", "group"],
  ["x-pole-target-service-version", "serviceVersion"],
  ["x-pole-target-method", "method"],
  ["x-pole-original-endpoint", "originalEndpoint"]
] as const satisfies readonly (readonly [string, keyof TargetEnvelope])[];

const INTERNAL_HEADER_NAMES = new Set([
  "x-pole-target-envelope-version",
  ...HEADER_FIELDS.map(([headerName]) => headerName)
]);

function assertUnicodeScalarValue(
  fieldName: keyof TargetEnvelope,
  value: string
): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        throw new TargetEnvelopeError(
          "INVALID_UNICODE_SCALAR",
          `${fieldName} must contain only Unicode scalar values`
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TargetEnvelopeError(
        "INVALID_UNICODE_SCALAR",
        `${fieldName} must contain only Unicode scalar values`
      );
    }
  }
}

function normalizeField(
  fieldName: keyof TargetEnvelope,
  value: unknown,
  required: boolean
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string`);
  }

  assertUnicodeScalarValue(fieldName, value);

  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new TargetEnvelopeError(
      "CONTROL_CHARACTER",
      `${fieldName} must not contain control characters`
    );
  }

  const normalizedValue = value.replace(
    LEADING_OR_TRAILING_WHITESPACE_PATTERN,
    ""
  );

  if (required && normalizedValue.length === 0) {
    throw new TargetEnvelopeError(
      "REQUIRED_FIELD_EMPTY",
      `${fieldName} must not be empty`
    );
  }

  return normalizedValue;
}

function validatePort(portText: string): void {
  const port = Number(portText);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    String(port) !== portText
  ) {
    throw new TargetEnvelopeError(
      "INVALID_ORIGINAL_ENDPOINT",
      "originalEndpoint port must be canonical decimal between 1 and 65535"
    );
  }
}

function validateOriginalEndpoint(endpoint: string): void {
  const ipv6Match = IPV6_PORT_PATTERN.exec(endpoint);
  if (ipv6Match !== null) {
    const host = ipv6Match[1];
    const port = ipv6Match[2];
    if (
      host === undefined ||
      port === undefined ||
      host.includes("%") ||
      isIP(host) !== 6
    ) {
      throw new TargetEnvelopeError(
        "INVALID_ORIGINAL_ENDPOINT",
        "originalEndpoint must use host:port or [ipv6]:port format"
      );
    }
    validatePort(port);
    return;
  }

  const hostMatch = HOST_PORT_PATTERN.exec(endpoint);
  if (
    hostMatch === null ||
    hostMatch[1] === undefined ||
    hostMatch[2] === undefined ||
    INVALID_HOST_CHARACTER_PATTERN.test(hostMatch[1])
  ) {
    throw new TargetEnvelopeError(
      "INVALID_ORIGINAL_ENDPOINT",
      "originalEndpoint must use host:port or [ipv6]:port format"
    );
  }

  validatePort(hostMatch[2]);
}

function encodeHeaderValue(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    if (byte >= 0x20 && byte <= 0x7e && byte !== 0x25 && byte !== 0x2c) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return encoded;
}

export function createTargetEnvelope(
  input: TargetEnvelopeInput
): Readonly<TargetEnvelope> {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("target envelope input must be an object");
  }

  const envelope: MutableTargetEnvelope = {
    namespace: normalizeField("namespace", input.namespace, true),
    service: normalizeField("service", input.service, true)
  };

  for (const fieldName of [
    "protocol",
    "group",
    "serviceVersion",
    "method",
    "originalEndpoint"
  ] as const) {
    const value = input[fieldName];
    if (value !== undefined) {
      const normalizedValue = normalizeField(fieldName, value, false);
      if (normalizedValue.length > 0) {
        envelope[fieldName] = normalizedValue;
      }
    }
  }

  if (envelope.originalEndpoint !== undefined) {
    validateOriginalEndpoint(envelope.originalEndpoint);
  }

  return Object.freeze(envelope);
}

export function encodeTargetEnvelopeHeaders(
  envelope: Readonly<TargetEnvelope>,
  headers: HttpHeaders = {}
): HttpHeaders {
  const normalizedEnvelope = createTargetEnvelope(envelope);
  const encodedHeaders: Record<string, string> = {};

  for (const headerName of Object.keys(headers)) {
    if (!INTERNAL_HEADER_NAMES.has(headerName.toLowerCase())) {
      Object.defineProperty(encodedHeaders, headerName, {
        configurable: true,
        enumerable: true,
        value: headers[headerName]!,
        writable: true
      });
    }
  }

  encodedHeaders["x-pole-target-envelope-version"] =
    TARGET_ENVELOPE_VERSION;

  for (const [headerName, fieldName] of HEADER_FIELDS) {
    const value = normalizedEnvelope[fieldName];
    if (value !== undefined) {
      encodedHeaders[headerName] = encodeHeaderValue(value);
    }
  }

  return Object.freeze(encodedHeaders);
}
