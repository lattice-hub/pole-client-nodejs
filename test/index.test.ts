import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import {
  DEFAULT_SIDECAR_SOCKET,
  SDK_LANGUAGE,
  SidecarBootstrapError,
  SidecarUnavailableError,
  TargetServiceError,
  connectSidecarSession,
  createTargetService,
  encodeTargetServiceMetadata,
  type SidecarProtocol,
  type TargetServiceInput
} from "@lattice-hub/pole-client-nodejs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACT_ROOT = join(PROJECT_ROOT, "contract");
const CONFORMANCE_PATH = join(CONTRACT_ROOT, "conformance.json");
const BOOTSTRAP_PROTO_PATH = join(CONTRACT_ROOT, "bootstrap.proto");

type HeaderPair = readonly [string, string];
type ValidVector = {
  readonly name: string;
  readonly input: TargetServiceInput;
  readonly normalized: TargetServiceInput;
  readonly expected_metadata: readonly HeaderPair[];
};
type InvalidVector = {
  readonly name: string;
  readonly input: TargetServiceInput;
  readonly diagnostic: string;
};
type Conformance = {
  readonly contract: string;
  readonly contract_version: string;
  readonly valid: readonly ValidVector[];
  readonly invalid: readonly InvalidVector[];
  readonly sidecar_receive: {
    readonly valid: readonly unknown[];
    readonly invalid: readonly unknown[];
  };
};
type ClientHello = {
  readonly sdk_language: string;
  readonly sdk_version: string;
  readonly supported_protocols: readonly string[];
};
type ClientEvent = {
  readonly hello?: ClientHello;
  readonly register_local_service?: {
    readonly registration_id: string;
    readonly namespace: string;
    readonly service: string;
    readonly protocol: string;
    readonly local_port: number;
  };
  readonly unregister_local_service?: {
    readonly registration_id: string;
  };
};
type Listener = {
  readonly protocol: string;
  readonly port: number;
};
type SidecarEvent = {
  readonly listener_snapshot?: {
    readonly listeners: readonly Listener[];
  };
  readonly local_service_status?: {
    readonly registration_id: string;
    readonly state: string;
    readonly message: string;
  };
};
type SessionHandler = (
  call: grpc.ServerDuplexStream<ClientEvent, SidecarEvent>
) => void;
type BootstrapService = grpc.ServiceClientConstructor;
type BootstrapGrpcObject = {
  readonly pole: {
    readonly sidecar: {
      readonly v1: {
        readonly SidecarSessionService: BootstrapService;
      };
    };
  };
};

const conformance = JSON.parse(
  readFileSync(CONFORMANCE_PATH, "utf8")
) as Conformance;
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

const VALID_LISTENERS: readonly Listener[] = [
  { protocol: "PROTOCOL_HTTP", port: 21_001 },
  { protocol: "PROTOCOL_GRPC", port: 21_002 },
  { protocol: "PROTOCOL_DUBBO", port: 21_003 },
  { protocol: "PROTOCOL_THRIFT", port: 21_004 }
];

async function startBootstrapServer(
  socketPath: string,
  handler: SessionHandler
): Promise<grpc.Server> {
  const server = new grpc.Server();
  server.addService(bootstrapService.service, {
    OpenControlSession: handler
  } as grpc.UntypedServiceImplementation);
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `unix:${socketPath}`,
      grpc.ServerCredentials.createInsecure(),
      (error) => (error === null ? resolve() : reject(error))
    );
  });
  return server;
}

function writeSnapshot(
  call: grpc.ServerDuplexStream<ClientEvent, SidecarEvent>,
  listeners: readonly Listener[] = VALID_LISTENERS
): void {
  call.write({ listener_snapshot: { listeners } });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("condition did not become true before timeout");
}

function createSocketDirectory(): { readonly directory: string; readonly socketPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "pole-client-nodejs-"));
  return { directory, socketPath: join(directory, "bootstrap.sock") };
}

test("导出的默认 UDS 路径符合 bootstrap 契约", () => {
  assert.equal(DEFAULT_SIDECAR_SOCKET, "/var/run/pole/sidecar/bootstrap.sock");
  assert.equal(SDK_LANGUAGE, "nodejs");
  assert.equal(existsSync(join(PROJECT_ROOT, "dist/index.js")), true);
});

test("POLE_SIDECAR_SOCKET 覆盖默认 UDS 路径", async () => {
  const { directory, socketPath } = createSocketDirectory();
  const previousSocketPath = process.env.POLE_SIDECAR_SOCKET;
  let server: grpc.Server | undefined;
  try {
    server = await startBootstrapServer(socketPath, writeSnapshot);
    process.env.POLE_SIDECAR_SOCKET = socketPath;
    const session = await connectSidecarSession({ initializationTimeoutMs: 1_000 });
    try {
      assert.equal(session.socketPath, socketPath);
    } finally {
      session.close();
    }
  } finally {
    if (previousSocketPath === undefined) {
      delete process.env.POLE_SIDECAR_SOCKET;
    } else {
      process.env.POLE_SIDECAR_SOCKET = previousSocketPath;
    }
    server?.forceShutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("vendored 契约资产和校验和完整", () => {
  const checksumLines = readFileSync(
    join(CONTRACT_ROOT, "SHA256SUMS"),
    "utf8"
  )
    .trim()
    .split("\n");
  assert.deepEqual(
    checksumLines.map((line) => line.split(/\s+/u)[1]),
    [
      "schema.json",
      "conformance.json",
      "bootstrap.proto",
      "traffic-context/v1/README.md",
      "traffic-context/v1/schema.json",
      "traffic-context/v1/conformance.json",
      "traffic-context/v1/SHA256SUMS"
    ]
  );
  for (const line of checksumLines) {
    const [expected, fileName] = line.split(/\s+/u);
    assert.ok(expected);
    assert.ok(fileName);
    const actual = createHash("sha256")
      .update(readFileSync(join(CONTRACT_ROOT, fileName)))
      .digest("hex");
    assert.equal(actual, expected);
  }
  const version = readFileSync(join(CONTRACT_ROOT, "VERSION"), "utf8");
  assert.match(version, /^contract=latticehub-thin-sdk-sidecar$/mu);
  assert.match(version, /^target_service_wire_version=1$/mu);
  assert.match(version, /^traffic_context_wire_version=1$/mu);
  assert.match(version, /^sidecar_session_wire_version=1$/mu);
});

for (const vector of conformance.valid) {
  test(`TargetService valid 向量：${vector.name}`, () => {
    const targetService = createTargetService(vector.input);
    assert.deepEqual(targetService, vector.normalized);
    assert.equal(Object.isFrozen(targetService), true);
    assert.deepEqual(
      Object.entries(encodeTargetServiceMetadata(targetService)),
      vector.expected_metadata
    );
  });
}

for (const vector of conformance.invalid) {
  test(`TargetService invalid 向量：${vector.name}`, () => {
    assert.throws(
      () => createTargetService(vector.input),
      (error: unknown) =>
        error instanceof TargetServiceError && error.diagnostic === vector.diagnostic
    );
  });
}

test("TargetService 拒绝孤立 UTF-16 surrogate，并覆盖伪造内部元信息", () => {
  assert.throws(
    () => createTargetService({ namespace: "default", service: "\ud800" }),
    (error: unknown) =>
      error instanceof TargetServiceError &&
      error.diagnostic === "INVALID_UNICODE_SCALAR"
  );
  const metadata = encodeTargetServiceMetadata(
    createTargetService({ namespace: "default", service: "orders" }),
    {
      Authorization: "Bearer token",
      "LatticeHub-Target-Namespace": "forged",
      "latticehub-target-service": "forged"
    }
  );
  assert.deepEqual(Object.entries(metadata), [
    ["Authorization", "Bearer token"],
    ["latticehub-target-namespace", "default"],
    ["latticehub-target-service", "orders"]
  ]);
  assert.equal(Object.isFrozen(metadata), true);
});

test("OpenControlSession 首发 ClientHello，首帧原子安装四协议 listener", async () => {
  const { directory, socketPath } = createSocketDirectory();
  let server: grpc.Server | undefined;
  try {
    const clientEvents: ClientEvent[] = [];
    server = await startBootstrapServer(socketPath, (call) => {
      call.on("data", (event: ClientEvent) => {
        clientEvents.push(event);
        if (clientEvents.length === 1) {
          writeSnapshot(call);
        }
      });
    });
    const session = await connectSidecarSession({
      socketPath,
      initializationTimeoutMs: 1_000
    });
    try {
      assert.equal(session.listenerAddress("http"), "127.0.0.1:21001");
      assert.equal(session.listenerAddress("grpc"), "127.0.0.1:21002");
      assert.equal(session.listenerAddress("dubbo"), "127.0.0.1:21003");
      assert.equal(session.listenerAddress("thrift"), "127.0.0.1:21004");
      await waitUntil(() => clientEvents.length === 1);
      assert.deepEqual(clientEvents[0]?.hello?.supported_protocols, [
        "PROTOCOL_HTTP",
        "PROTOCOL_GRPC",
        "PROTOCOL_DUBBO",
        "PROTOCOL_THRIFT"
      ]);
      assert.equal(clientEvents[0]?.hello?.sdk_language, SDK_LANGUAGE);
      const concurrentReads = await Promise.all(
        Array.from({ length: 64 }, () =>
          Promise.resolve(session.listenerAddress("grpc" as SidecarProtocol))
        )
      );
      assert.deepEqual(concurrentReads, Array(64).fill("127.0.0.1:21002"));
    } finally {
      session.close();
    }
  } finally {
    server?.forceShutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("断流立即失效旧快照，并在重连首帧原子恢复", async () => {
  const { directory, socketPath } = createSocketDirectory();
  let firstServer: grpc.Server | undefined;
  let secondServer: grpc.Server | undefined;
  try {
    firstServer = await startBootstrapServer(socketPath, (call) => {
      call.once("data", () => writeSnapshot(call, VALID_LISTENERS));
    });
    const session = await connectSidecarSession({
      socketPath,
      initializationTimeoutMs: 1_000,
      retryInitialDelayMs: 20,
      retryMaxDelayMs: 50
    });
    try {
      firstServer.forceShutdown();
      firstServer = undefined;
      await waitUntil(() => !session.isAvailable);
      assert.throws(
        () => session.listenerAddress("http"),
        SidecarUnavailableError
      );
      secondServer = await startBootstrapServer(socketPath, (call) => {
        call.once("data", () => writeSnapshot(call, [
          { protocol: "PROTOCOL_HTTP", port: 22_001 },
          { protocol: "PROTOCOL_GRPC", port: 22_002 },
          { protocol: "PROTOCOL_DUBBO", port: 22_003 },
          { protocol: "PROTOCOL_THRIFT", port: 22_004 }
        ]));
      });
      await waitUntil(() => session.isAvailable);
      assert.equal(session.listenerAddress("http"), "127.0.0.1:22001");
      assert.equal(session.listenerAddress("thrift"), "127.0.0.1:22004");
    } finally {
      session.close();
    }
  } finally {
    firstServer?.forceShutdown();
    secondServer?.forceShutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("本地服务注册处理状态、重连重放并支持注销", async () => {
  const { directory, socketPath } = createSocketDirectory();
  let firstServer: grpc.Server | undefined;
  let secondServer: grpc.Server | undefined;
  try {
    const firstEvents: ClientEvent[] = [];
    firstServer = await startBootstrapServer(socketPath, (call) => {
      call.on("data", (event: ClientEvent) => {
        firstEvents.push(event);
        if (firstEvents.length === 1) {
          writeSnapshot(call);
        } else if (event.register_local_service !== undefined) {
          call.write({
            local_service_status: {
              registration_id: event.register_local_service.registration_id,
              state: "LOCAL_SERVICE_STATE_REGISTERED",
              message: "registered"
            }
          });
        }
      });
    });
    const session = await connectSidecarSession({
      socketPath,
      initializationTimeoutMs: 1_000,
      retryInitialDelayMs: 20,
      retryMaxDelayMs: 50
    });
    try {
      const registrationId = session.registerLocalService({
        namespace: "default",
        service: "catalog",
        protocol: "grpc",
        localPort: 50_051
      });
      await waitUntil(
        () => session.localServiceStatus(registrationId)?.state === "registered"
      );
      assert.equal(firstEvents[0]?.hello?.sdk_language, SDK_LANGUAGE);
      assert.equal(firstEvents[1]?.register_local_service?.registration_id, registrationId);

      firstServer.forceShutdown();
      firstServer = undefined;
      await waitUntil(() => !session.isAvailable);

      const replayedEvents: ClientEvent[] = [];
      secondServer = await startBootstrapServer(socketPath, (call) => {
        call.on("data", (event: ClientEvent) => {
          replayedEvents.push(event);
          if (replayedEvents.length === 1) {
            writeSnapshot(call);
          } else if (event.register_local_service !== undefined) {
            call.write({
              local_service_status: {
                registration_id: event.register_local_service.registration_id,
                state: "LOCAL_SERVICE_STATE_REGISTERED",
                message: "replayed"
              }
            });
          } else if (event.unregister_local_service !== undefined) {
            call.write({
              local_service_status: {
                registration_id: event.unregister_local_service.registration_id,
                state: "LOCAL_SERVICE_STATE_UNREGISTERED",
                message: "unregistered"
              }
            });
          }
        });
      });
      await waitUntil(
        () => session.localServiceStatus(registrationId)?.message === "replayed"
      );
      assert.deepEqual(replayedEvents[0]?.hello?.supported_protocols, [
        "PROTOCOL_HTTP",
        "PROTOCOL_GRPC",
        "PROTOCOL_DUBBO",
        "PROTOCOL_THRIFT"
      ]);
      assert.equal(
        replayedEvents[1]?.register_local_service?.registration_id,
        registrationId
      );
      assert.equal(session.unregisterLocalService(registrationId), true);
      await waitUntil(
        () => session.localServiceStatus(registrationId)?.state === "unregistered"
      );
      assert.equal(session.unregisterLocalService(registrationId), false);
    } finally {
      session.close();
    }
  } finally {
    firstServer?.forceShutdown();
    secondServer?.forceShutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("关闭会结束 OpenControlSession 客户端流", async () => {
  const { directory, socketPath } = createSocketDirectory();
  let server: grpc.Server | undefined;
  try {
    let clientStreamEnded = false;
    server = await startBootstrapServer(socketPath, (call) => {
      call.once("data", () => writeSnapshot(call));
      call.once("end", () => {
        clientStreamEnded = true;
        call.end();
      });
    });
    const session = await connectSidecarSession({
      socketPath,
      initializationTimeoutMs: 1_000
    });
    session.close();
    await waitUntil(() => clientStreamEnded);
  } finally {
    server?.forceShutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("缺少协议的首帧在有界初始化时间内失败", async () => {
  const { directory, socketPath } = createSocketDirectory();
  let server: grpc.Server | undefined;
  try {
    server = await startBootstrapServer(socketPath, (call) => {
      call.once("data", () => writeSnapshot(call, VALID_LISTENERS.slice(0, 3)));
    });
    await assert.rejects(
      connectSidecarSession({
        socketPath,
        initializationTimeoutMs: 100,
        retryInitialDelayMs: 10,
        retryMaxDelayMs: 20
      }),
      SidecarBootstrapError
    );
  } finally {
    server?.forceShutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("UDS 不可用时有界重试后初始化失败", async () => {
  const { directory, socketPath } = createSocketDirectory();
  try {
    await assert.rejects(
      connectSidecarSession({
        socketPath,
        initializationTimeoutMs: 100,
        retryInitialDelayMs: 10,
        retryMaxDelayMs: 20
      }),
      SidecarBootstrapError
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("干净 npm pack 会构建并包含新契约资产", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "pole-client-nodejs-pack-"));
  try {
    for (const fileName of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "README.md",
      "LICENSE"
    ]) {
      copyFileSync(join(PROJECT_ROOT, fileName), join(packageRoot, fileName));
    }
    cpSync(join(PROJECT_ROOT, "src"), join(packageRoot, "src"), {
      recursive: true
    });
    cpSync(CONTRACT_ROOT, join(packageRoot, "contract"), { recursive: true });
    symlinkSync(
      realpathSync(join(PROJECT_ROOT, "node_modules")),
      join(packageRoot, "node_modules")
    );

    const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageRoot,
      encoding: "utf8"
    });
    assert.equal(packed.status, 0, packed.stderr);
    const packResult = JSON.parse(packed.stdout) as [
      { readonly files: readonly { readonly path: string }[] }
    ];
    const packedFiles = new Set(packResult[0].files.map(({ path }) => path));
    assert.equal(packedFiles.has("dist/index.js"), true);
    assert.equal(packedFiles.has("dist/index.d.ts"), true);
    assert.equal(packedFiles.has("contract/schema.json"), true);
    assert.equal(packedFiles.has("contract/conformance.json"), true);
    assert.equal(packedFiles.has("contract/bootstrap.proto"), true);
    assert.equal(packedFiles.has("contract/SHA256SUMS"), true);
    assert.equal(packedFiles.has("contract/VERSION"), true);
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});
