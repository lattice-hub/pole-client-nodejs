export const TARGET_SERVICE_HEADER_NAMES = Object.freeze({
  namespace: "latticehub-target-namespace",
  service: "latticehub-target-service"
});

export type TargetServiceDiagnostic =
  | "INVALID_UNICODE_SCALAR"
  | "CONTROL_CHARACTER"
  | "EMPTY_NAMESPACE"
  | "EMPTY_SERVICE";

export class TargetServiceError extends TypeError {
  readonly diagnostic: TargetServiceDiagnostic;

  constructor(diagnostic: TargetServiceDiagnostic, message: string) {
    super(message);
    this.name = "TargetServiceError";
    this.diagnostic = diagnostic;
  }
}

export interface TargetServiceInput {
  readonly namespace: string;
  readonly service: string;
}

export interface TargetService {
  readonly namespace: string;
  readonly service: string;
}

export type Metadata = Readonly<Record<string, string>>;

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const LEADING_OR_TRAILING_WHITESPACE_PATTERN =
  /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu;

function assertUnicodeScalarValue(fieldName: keyof TargetService, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        throw new TargetServiceError(
          "INVALID_UNICODE_SCALAR",
          `${fieldName} must contain only Unicode scalar values`
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TargetServiceError(
        "INVALID_UNICODE_SCALAR",
        `${fieldName} must contain only Unicode scalar values`
      );
    }
  }
}

function normalizeField(fieldName: keyof TargetService, value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string`);
  }

  assertUnicodeScalarValue(fieldName, value);
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new TargetServiceError(
      "CONTROL_CHARACTER",
      `${fieldName} must not contain control characters`
    );
  }

  const normalized = value.replace(LEADING_OR_TRAILING_WHITESPACE_PATTERN, "");
  if (normalized.length === 0) {
    throw new TargetServiceError(
      fieldName === "namespace" ? "EMPTY_NAMESPACE" : "EMPTY_SERVICE",
      `${fieldName} must not be empty`
    );
  }
  return normalized;
}

function encodeCanonicalValue(value: string): string {
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

export function createTargetService(
  input: TargetServiceInput
): Readonly<TargetService> {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("target service input must be an object");
  }

  return Object.freeze({
    namespace: normalizeField("namespace", input.namespace),
    service: normalizeField("service", input.service)
  });
}

export function encodeTargetServiceMetadata(
  targetService: Readonly<TargetService>,
  metadata: Metadata = {}
): Metadata {
  const normalized = createTargetService(targetService);
  const encoded: Record<string, string> = Object.create(null) as Record<string, string>;
  const internalNames = new Set<string>(
    Object.values(TARGET_SERVICE_HEADER_NAMES)
  );

  for (const metadataName of Object.keys(metadata)) {
    if (!internalNames.has(metadataName.toLowerCase())) {
      Object.defineProperty(encoded, metadataName, {
        configurable: true,
        enumerable: true,
        value: metadata[metadataName]!,
        writable: true
      });
    }
  }

  encoded[TARGET_SERVICE_HEADER_NAMES.namespace] = encodeCanonicalValue(
    normalized.namespace
  );
  encoded[TARGET_SERVICE_HEADER_NAMES.service] = encodeCanonicalValue(
    normalized.service
  );
  return Object.freeze(encoded);
}

// encodeTargetServiceMetadataWithTrafficContext assembles TargetService and W3C Baggage
// at the same egress point. An explicit TrafficContext wins over current storage.
export function encodeTargetServiceMetadataWithTrafficContext(
  targetService: Readonly<TargetService>,
  metadata: Metadata = {},
  explicitTrafficContext?: Readonly<TrafficContext>
): Metadata {
  const targetMetadata = encodeTargetServiceMetadata(targetService, metadata);
  const baggageValues: string[] = [];
  let baggageName: string | undefined;
  for (const [name, value] of Object.entries(targetMetadata)) {
    if (name.toLowerCase() === BAGGAGE_HEADER_NAME) {
      baggageValues.push(value);
      baggageName ??= name;
    }
  }
  const baggage = injectTrafficContext(baggageValues, explicitTrafficContext);
  const encoded: Record<string, string> = Object.create(null) as Record<string, string>;
  let baggageWritten = false;
  for (const [name, value] of Object.entries(targetMetadata)) {
    if (name.toLowerCase() === BAGGAGE_HEADER_NAME) {
      if (!baggageWritten && baggage !== undefined) {
        Object.defineProperty(encoded, baggageName ?? BAGGAGE_HEADER_NAME, {
          configurable: true,
          enumerable: true,
          value: baggage,
          writable: true
        });
      }
      baggageWritten = true;
      continue;
    }
    Object.defineProperty(encoded, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    });
  }
  if (baggage !== undefined && !baggageWritten) {
    Object.defineProperty(encoded, baggageName ?? BAGGAGE_HEADER_NAME, {
      configurable: true,
      enumerable: true,
      value: baggage,
      writable: true
    });
  }
  return Object.freeze(encoded);
}
import {
  BAGGAGE_HEADER_NAME,
  type TrafficContext,
  injectTrafficContext
} from "./traffic-context.js";
