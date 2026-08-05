import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const DEFAULT_SIDECAR_SOCKET = "/var/run/pole/sidecar/bootstrap.sock";
export const SDK_LANGUAGE = "nodejs";
export const SDK_VERSION = "0.2.0";

export type SidecarProtocol = "http" | "grpc" | "dubbo" | "thrift";
export type LocalServiceState = "registered" | "unregistered" | "rejected";

export interface ListenerAddresses {
  readonly http: string;
  readonly grpc: string;
  readonly dubbo: string;
  readonly thrift: string;
}

export interface LocalServiceRegistrationInput {
  readonly namespace: string;
  readonly service: string;
  readonly protocol: SidecarProtocol;
  readonly localPort: number;
  readonly registrationId?: string;
}

export interface LocalServiceStatus {
  readonly registrationId: string;
  readonly state: LocalServiceState;
  readonly message: string;
}

export interface SidecarSessionOptions {
  readonly socketPath?: string;
  readonly initializationTimeoutMs?: number;
  readonly retryInitialDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly sdkVersion?: string;
}

export class SidecarBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarBootstrapError";
  }
}

export class SidecarUnavailableError extends Error {
  constructor() {
    super("Pole Sidecar listener snapshot is unavailable");
    this.name = "SidecarUnavailableError";
  }
}

type ClientHello = {
  readonly sdk_language: string;
  readonly sdk_version: string;
  readonly supported_protocols: readonly string[];
};

type LocalServiceRegistration = {
  readonly registration_id: string;
  readonly namespace: string;
  readonly service: string;
  readonly protocol: string;
  readonly local_port: number;
};

type ClientEvent = {
  readonly hello?: ClientHello;
  readonly register_local_service?: LocalServiceRegistration;
  readonly unregister_local_service?: { readonly registration_id: string };
};

type Listener = {
  readonly protocol?: string;
  readonly port?: number;
};

type SidecarEvent = {
  readonly listener_snapshot?: {
    readonly listeners?: readonly Listener[];
  };
  readonly local_service_status?: {
    readonly registration_id?: string;
    readonly state?: string;
    readonly message?: string;
  };
};

interface SidecarSessionClient extends grpc.Client {
  openControlSession(): grpc.ClientDuplexStream<ClientEvent, SidecarEvent>;
}

interface SidecarSessionClientConstructor {
  new (
    address: string,
    credentials: grpc.ChannelCredentials
  ): SidecarSessionClient;
}

interface BootstrapGrpcObject {
  readonly pole: {
    readonly sidecar: {
      readonly v1: {
        readonly SidecarSessionService: SidecarSessionClientConstructor;
      };
    };
  };
}

const PROTOCOL_WIRE_NAMES: Readonly<Record<SidecarProtocol, string>> = {
  http: "PROTOCOL_HTTP",
  grpc: "PROTOCOL_GRPC",
  dubbo: "PROTOCOL_DUBBO",
  thrift: "PROTOCOL_THRIFT"
};
const LOCAL_SERVICE_STATE_WIRE_NAMES: Readonly<Record<string, LocalServiceState>> = {
  LOCAL_SERVICE_STATE_REGISTERED: "registered",
  LOCAL_SERVICE_STATE_UNREGISTERED: "unregistered",
  LOCAL_SERVICE_STATE_REJECTED: "rejected"
};
const REQUIRED_PROTOCOLS = Object.freeze(
  Object.keys(PROTOCOL_WIRE_NAMES) as SidecarProtocol[]
);
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 1_000;
const BOOTSTRAP_PROTO_PATH = fileURLToPath(
  new URL("../contract/bootstrap.proto", import.meta.url)
);

const bootstrapDefinition = protoLoader.loadSync(BOOTSTRAP_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const bootstrapService = (
  grpc.loadPackageDefinition(bootstrapDefinition) as unknown as BootstrapGrpcObject
).pole.sidecar.v1.SidecarSessionService;

function resolveSocketPath(socketPath: string | undefined): string {
  const resolved = socketPath ?? process.env.POLE_SIDECAR_SOCKET ?? DEFAULT_SIDECAR_SOCKET;
  if (resolved.length === 0) {
    throw new TypeError("socketPath must not be empty");
  }
  return resolved;
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function normalizeRequiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function protocolFromWireName(protocol: string | undefined): SidecarProtocol {
  for (const requiredProtocol of REQUIRED_PROTOCOLS) {
    if (PROTOCOL_WIRE_NAMES[requiredProtocol] === protocol) {
      return requiredProtocol;
    }
  }
  throw new SidecarBootstrapError("listener snapshot contains an unknown protocol");
}

function parseListenerSnapshot(event: SidecarEvent): ListenerAddresses {
  if (event.listener_snapshot === undefined) {
    throw new SidecarBootstrapError("first Sidecar event must be listener_snapshot");
  }

  const ports = new Map<SidecarProtocol, number>();
  for (const listener of event.listener_snapshot.listeners ?? []) {
    const protocol = protocolFromWireName(listener.protocol);
    const port = listener.port;
    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      throw new SidecarBootstrapError("listener snapshot contains an invalid port");
    }
    if (ports.has(protocol)) {
      throw new SidecarBootstrapError("listener snapshot contains a duplicate protocol");
    }
    ports.set(protocol, port);
  }

  if (ports.size !== REQUIRED_PROTOCOLS.length) {
    throw new SidecarBootstrapError("listener snapshot must contain all four protocols");
  }

  const addressFor = (protocol: SidecarProtocol): string => {
    const port = ports.get(protocol);
    if (port === undefined) {
      throw new SidecarBootstrapError("listener snapshot must contain all four protocols");
    }
    return `127.0.0.1:${port}`;
  };
  return Object.freeze({
    http: addressFor("http"),
    grpc: addressFor("grpc"),
    dubbo: addressFor("dubbo"),
    thrift: addressFor("thrift")
  });
}

function parseLocalServiceStatus(event: SidecarEvent): LocalServiceStatus {
  const status = event.local_service_status;
  if (status === undefined) {
    throw new SidecarBootstrapError("Sidecar event must be local_service_status");
  }
  const registrationId = normalizeRequiredText(status.registration_id, "registration_id");
  const state = LOCAL_SERVICE_STATE_WIRE_NAMES[status.state ?? ""];
  if (state === undefined) {
    throw new SidecarBootstrapError("local service status contains an invalid state");
  }
  if (typeof status.message !== "string") {
    throw new SidecarBootstrapError("local service status contains an invalid message");
  }
  return Object.freeze({ registrationId, state, message: status.message });
}

function createLocalServiceRegistration(
  input: LocalServiceRegistrationInput
): LocalServiceRegistration {
  const registrationId = normalizeRequiredText(
    input.registrationId ?? randomUUID(),
    "registrationId"
  );
  const namespace = normalizeRequiredText(input.namespace, "namespace");
  const service = normalizeRequiredText(input.service, "service");
  if (!(input.protocol in PROTOCOL_WIRE_NAMES)) {
    throw new TypeError("protocol must be a supported Sidecar protocol");
  }
  validatePositiveInteger(input.localPort, "localPort");
  if (input.localPort > 65_535) {
    throw new TypeError("localPort must not exceed 65535");
  }
  return Object.freeze({
    registration_id: registrationId,
    namespace,
    service,
    protocol: PROTOCOL_WIRE_NAMES[input.protocol],
    local_port: input.localPort
  });
}

export class SidecarSession {
  readonly #socketPath: string;
  readonly #initializationTimeoutMs: number;
  readonly #retryInitialDelayMs: number;
  readonly #retryMaxDelayMs: number;
  readonly #sdkVersion: string;
  readonly #ready: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (reason: Error) => void;
  #initializationTimer: NodeJS.Timeout | undefined;
  #retryTimer: NodeJS.Timeout | undefined;
  #retryDelayMs: number;
  #activeCall: grpc.ClientDuplexStream<ClientEvent, SidecarEvent> | undefined;
  #activeClient: SidecarSessionClient | undefined;
  #listeners: ListenerAddresses | undefined;
  #desiredRegistrations = new Map<string, LocalServiceRegistration>();
  #localServiceStatuses = new Map<string, LocalServiceStatus>();
  #closed = false;
  #initialized = false;

  private constructor(options: SidecarSessionOptions) {
    this.#socketPath = resolveSocketPath(options.socketPath);
    this.#initializationTimeoutMs =
      options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS;
    this.#retryInitialDelayMs =
      options.retryInitialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
    this.#retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.#sdkVersion = options.sdkVersion ?? SDK_VERSION;
    validatePositiveInteger(this.#initializationTimeoutMs, "initializationTimeoutMs");
    validatePositiveInteger(this.#retryInitialDelayMs, "retryInitialDelayMs");
    validatePositiveInteger(this.#retryMaxDelayMs, "retryMaxDelayMs");
    if (this.#retryInitialDelayMs > this.#retryMaxDelayMs) {
      throw new TypeError("retryInitialDelayMs must not exceed retryMaxDelayMs");
    }
    this.#retryDelayMs = this.#retryInitialDelayMs;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
  }

  static async connect(options: SidecarSessionOptions = {}): Promise<SidecarSession> {
    const session = new SidecarSession(options);
    session.#openControlSession();
    session.#initializationTimer = setTimeout(() => {
      if (!session.#initialized) {
        const error = new SidecarBootstrapError(
          "Sidecar bootstrap did not provide a listener snapshot before timeout"
        );
        session.#rejectReady(error);
        session.close();
      }
    }, session.#initializationTimeoutMs);
    await session.#ready;
    return session;
  }

  get socketPath(): string {
    return this.#socketPath;
  }

  get isAvailable(): boolean {
    return this.#listeners !== undefined;
  }

  listenerAddress(protocol: SidecarProtocol): string {
    const listeners = this.#listeners;
    if (listeners === undefined) {
      throw new SidecarUnavailableError();
    }
    return listeners[protocol];
  }

  registerLocalService(input: LocalServiceRegistrationInput): string {
    if (this.#closed) {
      throw new SidecarBootstrapError("a closed SidecarSession cannot register local services");
    }
    const registration = createLocalServiceRegistration(input);
    const existing = this.#desiredRegistrations.get(registration.registration_id);
    if (existing !== undefined) {
      if (
        existing.namespace !== registration.namespace ||
        existing.service !== registration.service ||
        existing.protocol !== registration.protocol ||
        existing.local_port !== registration.local_port
      ) {
        throw new TypeError("registrationId is already used by another local service");
      }
      return registration.registration_id;
    }
    this.#desiredRegistrations.set(registration.registration_id, registration);
    this.#localServiceStatuses.delete(registration.registration_id);
    this.#writeEvent({ register_local_service: registration });
    return registration.registration_id;
  }

  unregisterLocalService(registrationId: string): boolean {
    const normalizedRegistrationId = normalizeRequiredText(registrationId, "registrationId");
    const registration = this.#desiredRegistrations.get(normalizedRegistrationId);
    if (registration === undefined) {
      return false;
    }
    this.#desiredRegistrations.delete(normalizedRegistrationId);
    this.#localServiceStatuses.delete(normalizedRegistrationId);
    this.#writeEvent({
      unregister_local_service: { registration_id: normalizedRegistrationId }
    });
    return true;
  }

  localServiceStatus(registrationId: string): LocalServiceStatus | undefined {
    return this.#localServiceStatuses.get(
      normalizeRequiredText(registrationId, "registrationId")
    );
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#listeners = undefined;
    this.#localServiceStatuses.clear();
    if (this.#initializationTimer !== undefined) {
      clearTimeout(this.#initializationTimer);
      this.#initializationTimer = undefined;
    }
    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
    this.#activeCall?.end();
    this.#activeCall = undefined;
    this.#activeClient?.close();
    this.#activeClient = undefined;
  }

  #openControlSession(): void {
    if (this.#closed || this.#activeCall !== undefined) {
      return;
    }

    const client = new bootstrapService(
      `unix:${this.#socketPath}`,
      grpc.credentials.createInsecure()
    );
    const call = client.openControlSession();
    let receivedFirstEvent = false;
    this.#activeClient = client;
    this.#activeCall = call;

    call.on("data", (event: SidecarEvent) => {
      try {
        if (!receivedFirstEvent) {
          receivedFirstEvent = true;
          this.#listeners = parseListenerSnapshot(event);
          this.#retryDelayMs = this.#retryInitialDelayMs;
          if (!this.#initialized) {
            this.#initialized = true;
            if (this.#initializationTimer !== undefined) {
              clearTimeout(this.#initializationTimer);
              this.#initializationTimer = undefined;
            }
            this.#resolveReady();
          }
          return;
        }
        const status = parseLocalServiceStatus(event);
        this.#localServiceStatuses.set(status.registrationId, status);
      } catch (error: unknown) {
        this.#finishAttempt(call, client);
        call.cancel();
        if (!this.#initialized) {
          this.#rejectReady(
            error instanceof SidecarBootstrapError
              ? error
              : new SidecarBootstrapError("Sidecar event is invalid")
          );
          this.close();
        }
      }
    });
    call.on("error", () => this.#finishAttempt(call, client));
    call.on("end", () => this.#finishAttempt(call, client));

    this.#writeEvent({
      hello: {
        sdk_language: SDK_LANGUAGE,
        sdk_version: this.#sdkVersion,
        supported_protocols: REQUIRED_PROTOCOLS.map(
          (protocol) => PROTOCOL_WIRE_NAMES[protocol]
        )
      }
    });
    for (const registration of this.#desiredRegistrations.values()) {
      this.#writeEvent({ register_local_service: registration });
    }
  }

  #writeEvent(event: ClientEvent): void {
    try {
      this.#activeCall?.write(event);
    } catch {
      return;
    }
  }

  #finishAttempt(
    call: grpc.ClientDuplexStream<ClientEvent, SidecarEvent>,
    client: SidecarSessionClient
  ): void {
    if (this.#activeCall !== call) {
      return;
    }
    this.#activeCall = undefined;
    this.#activeClient = undefined;
    this.#listeners = undefined;
    this.#localServiceStatuses.clear();
    client.close();
    if (!this.#closed) {
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#retryTimer !== undefined) {
      return;
    }
    const delayMs = this.#retryDelayMs;
    this.#retryDelayMs = Math.min(
      this.#retryDelayMs * 2,
      this.#retryMaxDelayMs
    );
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#openControlSession();
    }, delayMs);
  }
}

export function connectSidecarSession(
  options: SidecarSessionOptions = {}
): Promise<SidecarSession> {
  return SidecarSession.connect(options);
}
