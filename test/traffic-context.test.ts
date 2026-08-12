import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as otelApi from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

import {
  TrafficContextError,
  attachTrafficContext,
  createOpenTelemetryTrafficContextAdapter,
  createTrafficContext,
  currentTrafficContext,
  encodeTargetServiceMetadataWithTrafficContext,
  extractTrafficContext,
  injectTrafficContext,
  installOpenTelemetryTrafficContextAdapter,
  runWithTrafficContext,
  createTargetService,
  type TrafficContextDiagnostic
} from "@lattice-hub/pole-client-nodejs";

type TrafficContextConformance = {
  readonly valid: readonly {
    readonly name: string;
    readonly input: {
      readonly version: number;
      readonly labels: { readonly campaign?: string; readonly lane?: string; readonly bucket?: number };
    };
    readonly existing_baggage: readonly string[];
    readonly expected_baggage: string;
  }[];
  readonly sidecar_receive: {
    readonly valid: readonly {
      readonly name: string;
      readonly baggage: readonly string[];
      readonly expected: {
        readonly version: number;
        readonly labels: { readonly campaign?: string; readonly lane?: string; readonly bucket?: number };
      };
    }[];
    readonly invalid: readonly {
      readonly name: string;
      readonly baggage: readonly string[];
      readonly diagnostic: TrafficContextDiagnostic;
    }[];
  };
};

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const trafficContextConformance = JSON.parse(
  readFileSync(
    join(PROJECT_ROOT, "contract", "traffic-context", "v1", "conformance.json"),
    "utf8"
  )
) as TrafficContextConformance;

test("TrafficContext 执行 vendored 规范向量", () => {
  for (const vector of trafficContextConformance.valid) {
    assert.equal(vector.input.version, 1, `${vector.name}: input version`);
    assert.equal(
      injectTrafficContext(vector.existing_baggage, createTrafficContext(vector.input.labels)),
      vector.expected_baggage,
      vector.name
    );
  }
  for (const vector of trafficContextConformance.sidecar_receive.invalid) {
    assert.throws(
      () => extractTrafficContext(vector.baggage),
      (error: unknown) =>
        error instanceof TrafficContextError && error.diagnostic === vector.diagnostic,
      vector.name
    );
  }
  for (const vector of trafficContextConformance.sidecar_receive.valid) {
    assert.equal(vector.expected.version, 1, `${vector.name}: expected version`);
    assert.deepEqual(extractTrafficContext(vector.baggage), vector.expected.labels, vector.name);
  }
});

test("TrafficContext 规范编解码、保留外部 baggage 并拒绝非法值", () => {
  const traffic = createTrafficContext({
    campaign: "checkout v2",
    lane: "灰度",
    bucket: 7
  });
  const baggage = injectTrafficContext(
    ["vendor=value;property=one", "latticehub.traffic.version=0"],
    traffic
  );
  assert.equal(
    baggage,
    "vendor=value;property=one,latticehub.traffic.version=1,latticehub.traffic.campaign=checkout%20v2,latticehub.traffic.lane=%E7%81%B0%E5%BA%A6,latticehub.traffic.bucket=7"
  );
  assert.deepEqual(extractTrafficContext([baggage]), traffic);

  for (const value of [
    "latticehub.traffic.lane=gray",
    "latticehub.traffic.version=1,latticehub.traffic.lane=%67ray",
    "latticehub.traffic.version=1,latticehub.traffic.lane=gray,latticehub.traffic.lane=other"
  ]) {
    assert.throws(
      () => extractTrafficContext([value]),
      (error: unknown) => error instanceof TrafficContextError
    );
  }
});

test("TrafficContext AsyncLocalStorage scope 恢复且显式参数优先", () => {
  assert.equal(currentTrafficContext(), undefined);
  const scope = attachTrafficContext(createTrafficContext({ lane: "current" }));
  try {
    assert.deepEqual(currentTrafficContext(), { lane: "current" });
    assert.equal(
      injectTrafficContext([], createTrafficContext({ lane: "explicit" })),
      "latticehub.traffic.version=1,latticehub.traffic.lane=explicit"
    );
  } finally {
    scope.close();
  }
  assert.equal(currentTrafficContext(), undefined);
  assert.equal(injectTrafficContext(["latticehub.traffic.version=1"]), undefined);
});

test("TrafficContext 允许空 labels，并且仅清理旧保留成员", () => {
  const empty = createTrafficContext({});
  assert.deepEqual(extractTrafficContext(["latticehub.traffic.version=1"]), empty);
  assert.equal(
    injectTrafficContext(
      ["vendor=value,latticehub.traffic.version=1,latticehub.traffic.lane=stale"],
      empty
    ),
    "vendor=value"
  );
  assert.equal(injectTrafficContext([], empty), undefined);
});

test("TrafficContext baggage parser 支持 W3C OWS、外部空值和多 Header 限制", () => {
  const traffic = createTrafficContext({ lane: "gray" });
  assert.equal(
    injectTrafficContext(
      [" \tvendor \t= \t; property \t= \tvalue\t ", "\tother=\t"],
      traffic
    ),
    "vendor \t= \t; property \t= \tvalue,other=,latticehub.traffic.version=1,latticehub.traffic.lane=gray"
  );
  assert.deepEqual(
    extractTrafficContext([
      "\tlatticehub.traffic.version \t= \t1 ",
      " latticehub.traffic.lane = gray\t"
    ]),
    { lane: "gray" }
  );
  for (const value of ["vendor=hello world", "vendor=value; bad property=value", "vendor=\"value"]) {
    assert.throws(
      () => injectTrafficContext([value], traffic),
      (error: unknown) => error instanceof TrafficContextError
    );
  }
  assert.equal(
    injectTrafficContext(["LatticeHub.Traffic.Lane=foreign"], traffic),
    "LatticeHub.Traffic.Lane=foreign,latticehub.traffic.version=1,latticehub.traffic.lane=gray"
  );
  assert.equal(
    injectTrafficContext(
      ["vendor=value,latticehub.traffic.version=1,latticehub.traffic.future=stale"],
      traffic
    ),
    "vendor=value,latticehub.traffic.version=1,latticehub.traffic.lane=gray"
  );
  assert.throws(
    () => extractTrafficContext(["a".repeat(8192), "b"]),
    (error: unknown) => error instanceof TrafficContextError
  );
});

test("OTel run 使用标准 current，屏蔽外层 native 并允许内层 attach 覆盖", () => {
  const contextManager = new AsyncLocalStorageContextManager().enable();
  assert.equal(otelApi.context.setGlobalContextManager(contextManager), true);
  const adapter = createOpenTelemetryTrafficContextAdapter(otelApi);
  const baggage = otelApi.propagation
    .createBaggage()
    .setEntry("vendor", { value: "value" })
    .setEntry("latticehub.traffic.version", { value: "1" })
    .setEntry("latticehub.traffic.future", { value: "stale" });
  const ambient = otelApi.propagation.setBaggage(otelApi.ROOT_CONTEXT, baggage);
  try {
    otelApi.context.with(ambient, () => {
      assert.equal(adapter.current(), undefined);
      const outerScope = attachTrafficContext(createTrafficContext({ lane: "native-outer" }));
      try {
        const resetAdapter = installOpenTelemetryTrafficContextAdapter(otelApi);
        try {
          assert.deepEqual(currentTrafficContext(), { lane: "native-outer" });
          assert.equal(otelApi.context.active(), ambient);
          const installedAttach = attachTrafficContext(
            createTrafficContext({ lane: "native-installed" })
          );
          try {
            assert.deepEqual(currentTrafficContext(), { lane: "native-installed" });
            assert.equal(otelApi.context.active(), ambient);
          } finally {
            installedAttach.close();
          }
          assert.deepEqual(currentTrafficContext(), { lane: "native-outer" });

          runWithTrafficContext(createTrafficContext({ lane: "otel-run" }), () => {
            assert.deepEqual(currentTrafficContext(), { lane: "otel-run" });
            const activeBaggage = otelApi.propagation.getBaggage(otelApi.context.active());
            assert.equal(activeBaggage?.getEntry("vendor")?.value, "value");
            assert.equal(activeBaggage?.getEntry("latticehub.traffic.future"), undefined);
            assert.equal(activeBaggage?.getEntry("latticehub.traffic.lane")?.value, "otel-run");

            const innerScope = attachTrafficContext(createTrafficContext({ lane: "native-inner" }));
            try {
              assert.deepEqual(currentTrafficContext(), { lane: "native-inner" });
              assert.equal(
                otelApi.propagation
                  .getBaggage(otelApi.context.active())
                  ?.getEntry("latticehub.traffic.lane")?.value,
                "otel-run"
              );
            } finally {
              innerScope.close();
            }
            assert.deepEqual(currentTrafficContext(), { lane: "otel-run" });
          });
          assert.deepEqual(currentTrafficContext(), { lane: "native-outer" });
          assert.equal(otelApi.context.active(), ambient);
        } finally {
          resetAdapter();
        }
      } finally {
        outerScope.close();
      }
      assert.equal(currentTrafficContext(), undefined);
    });
  } finally {
    otelApi.context.disable();
    contextManager.disable();
  }
});

test("createOpenTelemetryTrafficContextAdapter 接受真实 @opentelemetry/api 模块", () => {
  const adapter = createOpenTelemetryTrafficContextAdapter(otelApi);
  assert.equal(typeof adapter.run, "function");
  assert.equal(typeof adapter.current, "function");
});

test("TargetService 与 TrafficContext 在同一出站编码点注入", () => {
  const scope = attachTrafficContext(createTrafficContext({ lane: "gray" }));
  try {
    const metadata = encodeTargetServiceMetadataWithTrafficContext(
      createTargetService({ namespace: "default", service: "orders" }),
      {
        Baggage: "vendor=value,latticehub.traffic.version=0",
        "Latticehub-Target-Namespace": "forged",
        "Latticehub-Target-Service": "forged"
      }
    );
    assert.deepEqual(Object.entries(metadata), [
      ["Baggage", "vendor=value,latticehub.traffic.version=1,latticehub.traffic.lane=gray"],
      ["latticehub-target-namespace", "default"],
      ["latticehub-target-service", "orders"]
    ]);
  } finally {
    scope.close();
  }
});
