import { AsyncLocalStorage } from "node:async_hooks";

export const BAGGAGE_HEADER_NAME = "baggage";

const TRAFFIC_BAGGAGE_PREFIX = "latticehub.traffic.";
const TRAFFIC_BAGGAGE_NAMES = Object.freeze({
  version: `${TRAFFIC_BAGGAGE_PREFIX}version`,
  campaign: `${TRAFFIC_BAGGAGE_PREFIX}campaign`,
  lane: `${TRAFFIC_BAGGAGE_PREFIX}lane`,
  bucket: `${TRAFFIC_BAGGAGE_PREFIX}bucket`
});
const TRAFFIC_BAGGAGE_LIMIT = 180;
const TRAFFIC_BAGGAGE_BYTE_LIMIT = 8192;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const LEADING_OR_TRAILING_WHITESPACE_PATTERN =
  /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu;

export type TrafficContextDiagnostic =
  | "INVALID_UNICODE_SCALAR"
  | "CONTROL_CHARACTER"
  | "EMPTY_LABEL"
  | "TRIMMED_LABEL"
  | "LABEL_TOO_LARGE"
  | "INVALID_BUCKET"
  | "EMPTY_TRAFFIC_CONTEXT"
  | "INVALID_BAGGAGE"
  | "UNKNOWN_RESERVED_KEY"
  | "DUPLICATE_VERSION"
  | "DUPLICATE_CAMPAIGN"
  | "DUPLICATE_LANE"
  | "DUPLICATE_BUCKET"
  | "MISSING_VERSION"
  | "UNSUPPORTED_VERSION"
  | "NON_CANONICAL_VALUE"
  | "TOO_MANY_MEMBERS"
  | "BAGGAGE_TOO_LARGE";

export class TrafficContextError extends TypeError {
  readonly diagnostic: TrafficContextDiagnostic;

  constructor(diagnostic: TrafficContextDiagnostic, message: string) {
    super(message);
    this.name = "TrafficContextError";
    this.diagnostic = diagnostic;
  }
}

export interface TrafficContextInput {
  readonly campaign?: string;
  readonly lane?: string;
  readonly bucket?: number;
}

export interface TrafficContext {
  readonly campaign?: string;
  readonly lane?: string;
  readonly bucket?: number;
}

export interface TrafficContextScope {
  close(): void;
}

export interface OpenTelemetryContextLike {
  getValue(key: symbol): unknown;
  setValue(key: symbol, value: unknown): OpenTelemetryContextLike;
  deleteValue(key: symbol): OpenTelemetryContextLike;
}

export interface OpenTelemetryBaggageEntryLike {
  readonly value: string;
  readonly metadata?: { toString(): string };
}

export interface OpenTelemetryBaggageLike {
  getEntry(name: string): OpenTelemetryBaggageEntryLike | undefined;
  getAllEntries(): [string, OpenTelemetryBaggageEntryLike][];
  removeEntry(name: string): OpenTelemetryBaggageLike;
  setEntry(name: string, entry: OpenTelemetryBaggageEntryLike): OpenTelemetryBaggageLike;
}

export interface OpenTelemetryApiLike {
  readonly createContextKey: (description: string) => symbol;
  readonly context: {
    active(): OpenTelemetryContextLike;
    with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
      context: OpenTelemetryContextLike,
      operation: F,
      thisArgument?: ThisParameterType<F>,
      ...arguments_: A
    ): ReturnType<F>;
  };
  readonly propagation: {
    getBaggage(context: OpenTelemetryContextLike): OpenTelemetryBaggageLike | undefined;
    createBaggage(): OpenTelemetryBaggageLike;
    setBaggage(
      context: OpenTelemetryContextLike,
      baggage: OpenTelemetryBaggageLike
    ): OpenTelemetryContextLike;
  };
}

export interface OpenTelemetryTrafficContextAdapter {
  current(): Readonly<TrafficContext> | undefined;
  run<T>(traffic: Readonly<TrafficContext> | undefined, operation: () => T): T;
}

type BaggageMember = {
  readonly raw: string;
  readonly name: string;
  readonly value: string;
  readonly properties: readonly string[];
};

type MutableTrafficContext = {
  campaign?: string;
  lane?: string;
  bucket?: number;
};

type NativeTrafficContextState = {
  readonly traffic: Readonly<TrafficContext> | undefined;
};

type OpenTelemetryRunState = {
  readonly adapter: OpenTelemetryTrafficContextAdapter;
  readonly nativeAtEntry: NativeTrafficContextState | undefined;
};

const nativeTrafficContextStorage = new AsyncLocalStorage<NativeTrafficContextState | undefined>();
const openTelemetryRunStorage = new AsyncLocalStorage<OpenTelemetryRunState>();
let installedOpenTelemetryAdapter: OpenTelemetryTrafficContextAdapter | undefined;

export function createTrafficContext(
  input: TrafficContextInput
): Readonly<TrafficContext> {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("TrafficContext input must be an object");
  }
  const normalized: MutableTrafficContext = {};
  if (input.campaign !== undefined) {
    normalized.campaign = validateLabel("campaign", input.campaign);
  }
  if (input.lane !== undefined) {
    normalized.lane = validateLabel("lane", input.lane);
  }
  if (input.bucket !== undefined) {
    if (!Number.isInteger(input.bucket) || input.bucket < 0 || input.bucket > 9999) {
      throw new TrafficContextError(
        "INVALID_BUCKET",
        "bucket must be an integer between 0 and 9999"
      );
    }
    normalized.bucket = input.bucket;
  }
  return Object.freeze(normalized);
}

export function currentTrafficContext(): Readonly<TrafficContext> | undefined {
  const native = nativeTrafficContextStorage.getStore();
  const openTelemetryRun = openTelemetryRunStorage.getStore();
  if (openTelemetryRun !== undefined) {
    if (native !== openTelemetryRun.nativeAtEntry) {
      return native?.traffic;
    }
    return openTelemetryRun.adapter.current();
  }
  if (native !== undefined) {
    return native.traffic;
  }
  return installedOpenTelemetryAdapter?.current();
}

export function attachTrafficContext(
  traffic: Readonly<TrafficContext>
): TrafficContextScope {
  const normalized = createTrafficContext(traffic);
  const previous = nativeTrafficContextStorage.getStore();
  nativeTrafficContextStorage.enterWith({ traffic: normalized });
  let closed = false;
  return Object.freeze({
    close(): void {
      if (!closed) {
        closed = true;
        nativeTrafficContextStorage.enterWith(previous);
      }
    }
  });
}

export function resetTrafficContext(): void {
  nativeTrafficContextStorage.enterWith({ traffic: undefined });
}

export function runWithTrafficContext<T>(
  traffic: Readonly<TrafficContext>,
  operation: () => T
): T {
  const normalized = createTrafficContext(traffic);
  if (installedOpenTelemetryAdapter !== undefined) {
    return installedOpenTelemetryAdapter.run(normalized, operation);
  }
  return nativeTrafficContextStorage.run({ traffic: normalized }, operation);
}

export function extractTrafficContext(
  values: readonly string[]
): Readonly<TrafficContext> | undefined {
  const members = parseBaggageMembers(values);
  let versionFound = false;
  let labelFound = false;
  let campaign: string | undefined;
  let lane: string | undefined;
  let bucket: number | undefined;

  for (const member of members) {
    if (!isTrafficBaggageName(member.name)) {
      if (isTrafficBaggagePrefix(member.name)) {
        throw new TrafficContextError(
          "UNKNOWN_RESERVED_KEY",
          `unknown TrafficContext baggage key ${member.name}`
        );
      }
      continue;
    }
    if (member.properties.length !== 0) {
      throw new TrafficContextError(
        "INVALID_BAGGAGE",
        `TrafficContext baggage key ${member.name} must not have properties`
      );
    }
    switch (member.name) {
      case TRAFFIC_BAGGAGE_NAMES.version:
        if (versionFound) {
          throw duplicateTrafficField(member.name);
        }
        if (member.value !== "1") {
          throw new TrafficContextError(
            "UNSUPPORTED_VERSION",
            `unsupported TrafficContext version ${member.value}`
          );
        }
        versionFound = true;
        break;
      case TRAFFIC_BAGGAGE_NAMES.campaign:
        if (campaign !== undefined) {
          throw duplicateTrafficField(member.name);
        }
        campaign = decodeCanonicalLabel(member.value);
        labelFound = true;
        break;
      case TRAFFIC_BAGGAGE_NAMES.lane:
        if (lane !== undefined) {
          throw duplicateTrafficField(member.name);
        }
        lane = decodeCanonicalLabel(member.value);
        labelFound = true;
        break;
      case TRAFFIC_BAGGAGE_NAMES.bucket:
        if (bucket !== undefined) {
          throw duplicateTrafficField(member.name);
        }
        bucket = decodeBucket(member.value);
        labelFound = true;
        break;
    }
  }
  if (!labelFound) {
    if (versionFound) {
      return createTrafficContext({});
    }
    return undefined;
  }
  if (!versionFound) {
    throw new TrafficContextError(
      "MISSING_VERSION",
      "TrafficContext labels require version"
    );
  }
  const input: MutableTrafficContext = {};
  if (campaign !== undefined) {
    input.campaign = campaign;
  }
  if (lane !== undefined) {
    input.lane = lane;
  }
  if (bucket !== undefined) {
    input.bucket = bucket;
  }
  return createTrafficContext(input);
}

export function injectTrafficContext(
  existing: readonly string[] = [],
  explicit?: Readonly<TrafficContext>
): string | undefined {
  const traffic = explicit === undefined ? currentTrafficContext() : createTrafficContext(explicit);
  const members = parseBaggageMembers(existing);
  const encoded: string[] = [];
  for (const member of members) {
    if (isTrafficBaggagePrefix(member.name)) {
      continue;
    }
    encoded.push(member.raw);
  }
  if (traffic !== undefined && trafficHasLabels(traffic)) {
    const normalized = createTrafficContext(traffic);
    encoded.push(`${TRAFFIC_BAGGAGE_NAMES.version}=1`);
    if (normalized.campaign !== undefined) {
      encoded.push(
        `${TRAFFIC_BAGGAGE_NAMES.campaign}=${encodeCanonicalLabel(normalized.campaign)}`
      );
    }
    if (normalized.lane !== undefined) {
      encoded.push(`${TRAFFIC_BAGGAGE_NAMES.lane}=${encodeCanonicalLabel(normalized.lane)}`);
    }
    if (normalized.bucket !== undefined) {
      encoded.push(`${TRAFFIC_BAGGAGE_NAMES.bucket}=${normalized.bucket}`);
    }
  }
  if (encoded.length === 0) {
    return undefined;
  }
  if (encoded.length > TRAFFIC_BAGGAGE_LIMIT) {
    throw new TrafficContextError(
      "TOO_MANY_MEMBERS",
      `baggage has ${encoded.length} members, maximum is ${TRAFFIC_BAGGAGE_LIMIT}`
    );
  }
  const result = encoded.join(",");
  if (Buffer.byteLength(result, "utf8") > TRAFFIC_BAGGAGE_BYTE_LIMIT) {
    throw new TrafficContextError(
      "BAGGAGE_TOO_LARGE",
      `baggage exceeds ${TRAFFIC_BAGGAGE_BYTE_LIMIT} bytes`
    );
  }
  return result;
}

// createOpenTelemetryTrafficContextAdapter accepts a caller-provided @opentelemetry/api object.
// This keeps the core SDK loadable when @opentelemetry/api is not installed.
export function createOpenTelemetryTrafficContextAdapter(
  api: OpenTelemetryApiLike
): OpenTelemetryTrafficContextAdapter {
  const contextKey = api.createContextKey("latticehub.traffic-context");
  const createNextContext = (traffic: Readonly<TrafficContext> | undefined): OpenTelemetryContextLike => {
    const parent = api.context.active();
    const normalized = traffic === undefined ? undefined : createTrafficContext(traffic);
    return api.propagation.setBaggage(
      parent.setValue(contextKey, normalized),
      toOpenTelemetryBaggage(parent, normalized, api)
    );
  };
  const adapter: OpenTelemetryTrafficContextAdapter = {
    current(): Readonly<TrafficContext> | undefined {
      return trafficContextFromOpenTelemetryContext(api.context.active(), api, contextKey);
    },
    run<T>(traffic: Readonly<TrafficContext> | undefined, operation: () => T): T {
      const next = createNextContext(traffic);
      return openTelemetryRunStorage.run(
        { adapter, nativeAtEntry: nativeTrafficContextStorage.getStore() },
        () => api.context.with(next, operation)
      );
    }
  };
  return Object.freeze(adapter);
}

// installOpenTelemetryTrafficContextAdapter makes an optional @opentelemetry/api bridge the current source.
// The returned reset function restores the preceding adapter.
export function installOpenTelemetryTrafficContextAdapter(
  api: OpenTelemetryApiLike
): () => void {
  const previous = installedOpenTelemetryAdapter;
  const installed = createOpenTelemetryTrafficContextAdapter(api);
  installedOpenTelemetryAdapter = installed;
  return (): void => {
    if (installedOpenTelemetryAdapter === installed) {
      installedOpenTelemetryAdapter = previous;
    }
  };
}

function trafficContextFromOpenTelemetryContext(
  context: OpenTelemetryContextLike,
  api: OpenTelemetryApiLike,
  contextKey: symbol
): Readonly<TrafficContext> | undefined {
  const baggage = api.propagation.getBaggage(context);
  if (baggage !== undefined) {
    for (const [name, entry] of baggage.getAllEntries()) {
      if (isTrafficBaggagePrefix(name) && !isTrafficBaggageName(name)) {
        return undefined;
      }
      if (
        isTrafficBaggageName(name) &&
        entry.metadata !== undefined &&
        entry.metadata.toString() !== ""
      ) {
        return undefined;
      }
    }
  }
  const stored = context.getValue(contextKey);
  if (typeof stored === "object" && stored !== null) {
    try {
      return createTrafficContext(stored as TrafficContextInput);
    } catch {
      return undefined;
    }
  }
  if (baggage === undefined) {
    return undefined;
  }
  const version = baggage.getEntry(TRAFFIC_BAGGAGE_NAMES.version)?.value;
  const campaign = baggage.getEntry(TRAFFIC_BAGGAGE_NAMES.campaign)?.value;
  const lane = baggage.getEntry(TRAFFIC_BAGGAGE_NAMES.lane)?.value;
  const bucketValue = baggage.getEntry(TRAFFIC_BAGGAGE_NAMES.bucket)?.value;
  if (campaign === undefined && lane === undefined && bucketValue === undefined) {
    return version === "1" ? createTrafficContext({}) : undefined;
  }
  if (version !== "1") {
    return undefined;
  }
  const input: MutableTrafficContext = {};
  if (campaign !== undefined) {
    input.campaign = campaign;
  }
  if (lane !== undefined) {
    input.lane = lane;
  }
  if (bucketValue !== undefined) {
    const bucket = Number(bucketValue);
    if (!Number.isInteger(bucket)) {
      return undefined;
    }
    input.bucket = bucket;
  }
  try {
    return createTrafficContext(input);
  } catch {
    return undefined;
  }
}

function toOpenTelemetryBaggage(
  parent: OpenTelemetryContextLike,
  traffic: Readonly<TrafficContext> | undefined,
  api: OpenTelemetryApiLike
): OpenTelemetryBaggageLike {
  let baggage = api.propagation.getBaggage(parent) ?? api.propagation.createBaggage();
  for (const [name] of baggage.getAllEntries()) {
    if (isTrafficBaggagePrefix(name)) {
      baggage = baggage.removeEntry(name);
    }
  }
  if (traffic === undefined || !trafficHasLabels(traffic)) {
    return baggage;
  }
  baggage = baggage.setEntry(TRAFFIC_BAGGAGE_NAMES.version, { value: "1" });
  if (traffic.campaign !== undefined) {
    baggage = baggage.setEntry(TRAFFIC_BAGGAGE_NAMES.campaign, {
      value: traffic.campaign
    });
  }
  if (traffic.lane !== undefined) {
    baggage = baggage.setEntry(TRAFFIC_BAGGAGE_NAMES.lane, { value: traffic.lane });
  }
  if (traffic.bucket !== undefined) {
    baggage = baggage.setEntry(TRAFFIC_BAGGAGE_NAMES.bucket, {
      value: String(traffic.bucket)
    });
  }
  return baggage;
}

function validateLabel(fieldName: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string`);
  }
  assertUnicodeScalarValue(fieldName, value);
  if (value.length === 0) {
    throw new TrafficContextError("EMPTY_LABEL", `${fieldName} must not be empty`);
  }
  if (Buffer.byteLength(value, "utf8") > 128) {
    throw new TrafficContextError(
      "LABEL_TOO_LARGE",
      `${fieldName} must not exceed 128 UTF-8 bytes`
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new TrafficContextError(
      "CONTROL_CHARACTER",
      `${fieldName} must not contain control characters`
    );
  }
  if (value.replace(LEADING_OR_TRAILING_WHITESPACE_PATTERN, "") !== value) {
    throw new TrafficContextError(
      "TRIMMED_LABEL",
      `${fieldName} must not have leading or trailing whitespace`
    );
  }
  return value;
}

function assertUnicodeScalarValue(fieldName: string, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TrafficContextError(
          "INVALID_UNICODE_SCALAR",
          `${fieldName} must contain only Unicode scalar values`
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TrafficContextError(
        "INVALID_UNICODE_SCALAR",
        `${fieldName} must contain only Unicode scalar values`
      );
    }
  }
}

function parseBaggageMembers(values: readonly string[]): readonly BaggageMember[] {
  const members: BaggageMember[] = [];
  let inputBytes = 0;
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") {
      throw new TrafficContextError("INVALID_BAGGAGE", "baggage carrier values must be strings");
    }
    inputBytes += Buffer.byteLength(value, "utf8") + (index === 0 ? 0 : 1);
  }
  if (inputBytes > TRAFFIC_BAGGAGE_BYTE_LIMIT) {
    throw new TrafficContextError(
      "BAGGAGE_TOO_LARGE",
      `baggage input exceeds ${TRAFFIC_BAGGAGE_BYTE_LIMIT} bytes`
    );
  }
  for (const value of values) {
    for (const candidate of value.split(",")) {
      const raw = candidate;
      const member = trimBaggageOWS(raw);
      if (member.length === 0) {
        throw new TrafficContextError("INVALID_BAGGAGE", "baggage contains an empty member");
      }
      const parts = member.split(";");
      const nameValue = parts[0];
      const separator = nameValue?.indexOf("=") ?? -1;
      if (nameValue === undefined || separator < 0) {
        throw new TrafficContextError("INVALID_BAGGAGE", `invalid baggage member ${raw}`);
      }
      const name = trimBaggageOWS(nameValue.slice(0, separator));
      const memberValue = trimBaggageOWS(nameValue.slice(separator + 1));
      if (!isBaggageToken(name) || !isBaggageOctetValue(memberValue)) {
        throw new TrafficContextError("INVALID_BAGGAGE", `invalid baggage member ${raw}`);
      }
      const properties: string[] = [];
      for (const rawProperty of parts.slice(1)) {
        const property = trimBaggageOWS(rawProperty);
        if (property.length === 0) {
          throw new TrafficContextError("INVALID_BAGGAGE", `invalid baggage property in ${raw}`);
        }
        const propertySeparator = property.indexOf("=");
        const propertyName = trimBaggageOWS(
          propertySeparator < 0 ? property : property.slice(0, propertySeparator)
        );
        const propertyValue =
          propertySeparator < 0
            ? ""
            : trimBaggageOWS(property.slice(propertySeparator + 1));
        if (!isBaggageToken(propertyName) || !isBaggageOctetValue(propertyValue)) {
          throw new TrafficContextError("INVALID_BAGGAGE", `invalid baggage property in ${raw}`);
        }
        properties.push(rawProperty);
      }
      members.push({ raw: member, name, value: memberValue, properties });
      if (members.length > TRAFFIC_BAGGAGE_LIMIT) {
        throw new TrafficContextError(
          "TOO_MANY_MEMBERS",
          `baggage has more than ${TRAFFIC_BAGGAGE_LIMIT} members`
        );
      }
    }
  }
  return members;
}

function trimBaggageOWS(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/gu, "");
}

function decodeCanonicalLabel(value: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f && isUnreserved(code)) {
      bytes.push(code);
      continue;
    }
    if (
      value[index] !== "%" ||
      index + 2 >= value.length ||
      !isUpperHex(value.charCodeAt(index + 1)) ||
      !isUpperHex(value.charCodeAt(index + 2))
    ) {
      throw new TrafficContextError(
        "NON_CANONICAL_VALUE",
        "TrafficContext label is not canonical percent encoding"
      );
    }
    bytes.push(
      (fromHex(value.charCodeAt(index + 1)) << 4) |
        fromHex(value.charCodeAt(index + 2))
    );
    index += 2;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw new TrafficContextError("INVALID_BAGGAGE", "TrafficContext label is invalid UTF-8");
  }
  validateLabel("label", decoded);
  if (encodeCanonicalLabel(decoded) !== value) {
    throw new TrafficContextError(
      "NON_CANONICAL_VALUE",
      "TrafficContext label is not canonical percent encoding"
    );
  }
  return decoded;
}

function decodeBucket(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TrafficContextError("INVALID_BUCKET", `invalid bucket ${value}`);
  }
  const bucket = Number(value);
  if (!Number.isSafeInteger(bucket) || bucket > 9999) {
    throw new TrafficContextError("INVALID_BUCKET", `invalid bucket ${value}`);
  }
  return bucket;
}

function encodeCanonicalLabel(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    if (isUnreserved(byte)) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return encoded;
}

function duplicateTrafficField(name: string): TrafficContextError {
  let diagnostic: TrafficContextDiagnostic;
  switch (name) {
    case TRAFFIC_BAGGAGE_NAMES.version:
      diagnostic = "DUPLICATE_VERSION";
      break;
    case TRAFFIC_BAGGAGE_NAMES.campaign:
      diagnostic = "DUPLICATE_CAMPAIGN";
      break;
    case TRAFFIC_BAGGAGE_NAMES.lane:
      diagnostic = "DUPLICATE_LANE";
      break;
    case TRAFFIC_BAGGAGE_NAMES.bucket:
      diagnostic = "DUPLICATE_BUCKET";
      break;
    default:
      diagnostic = "INVALID_BAGGAGE";
      break;
  }
  return new TrafficContextError(diagnostic, `duplicate TrafficContext baggage key ${name}`);
}

function isTrafficBaggageName(name: string): boolean {
  return Object.values(TRAFFIC_BAGGAGE_NAMES).includes(name as never);
}

function isTrafficBaggagePrefix(name: string): boolean {
  return name.startsWith(TRAFFIC_BAGGAGE_PREFIX);
}

function trafficHasLabels(traffic: Readonly<TrafficContext>): boolean {
  return (
    traffic.campaign !== undefined ||
    traffic.lane !== undefined ||
    traffic.bucket !== undefined
  );
}

function isBaggageToken(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(value);
}

function isBaggageOctetValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x21 ||
      (code >= 0x23 && code <= 0x2b) ||
      (code >= 0x2d && code <= 0x3a) ||
      (code >= 0x3c && code <= 0x5b) ||
      (code >= 0x5d && code <= 0x7e)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function isUnreserved(value: number): boolean {
  return (
    (value >= 0x41 && value <= 0x5a) ||
    (value >= 0x61 && value <= 0x7a) ||
    (value >= 0x30 && value <= 0x39) ||
    value === 0x2d ||
    value === 0x2e ||
    value === 0x5f ||
    value === 0x7e
  );
}

function isUpperHex(value: number): boolean {
  return (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x46);
}

function fromHex(value: number): number {
  return value >= 0x30 && value <= 0x39 ? value - 0x30 : value - 0x41 + 10;
}
