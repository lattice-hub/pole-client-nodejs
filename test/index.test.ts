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

import {
  DEFAULT_SIDECAR_ENDPOINT,
  TARGET_ENVELOPE_VERSION,
  TargetEnvelopeError,
  createTargetEnvelope,
  encodeTargetEnvelopeHeaders,
  type TargetEnvelope,
  type TargetEnvelopeInput
} from "@pole-io/pole-client-nodejs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACT_ROOT = join(PROJECT_ROOT, "contract");
const CONFORMANCE_PATH = join(CONTRACT_ROOT, "conformance.json");

type HeaderPair = readonly [string, string];
type ContractInput = {
  readonly namespace: string;
  readonly service: string;
  readonly protocol?: string;
  readonly group?: string;
  readonly service_version?: string;
  readonly method?: string;
  readonly original_endpoint?: string;
};
type ValidVector = {
  readonly name: string;
  readonly input: ContractInput;
  readonly base_headers?: readonly HeaderPair[];
  readonly normalized: ContractInput;
  readonly expected_headers: readonly HeaderPair[];
};
type InvalidVector = {
  readonly name: string;
  readonly input: ContractInput;
  readonly diagnostic: string;
};
type LanguageInvalidVector = {
  readonly name: string;
  readonly field: keyof ContractInput;
  readonly utf16_code_units: readonly string[];
  readonly diagnostic: string;
};
type ReceiveValidVector = {
  readonly name: string;
  readonly headers: readonly HeaderPair[];
  readonly expected_envelope: ContractInput;
};
type ReceiveInvalidVector = {
  readonly name: string;
  readonly headers: readonly HeaderPair[];
  readonly diagnostic: string;
};
type Conformance = {
  readonly contract: string;
  readonly contract_version: string;
  readonly envelope_version: string;
  readonly valid: readonly ValidVector[];
  readonly invalid: readonly InvalidVector[];
  readonly language_specific_invalid: readonly LanguageInvalidVector[];
  readonly sidecar_receive: {
    readonly valid: readonly ReceiveValidVector[];
    readonly invalid: readonly ReceiveInvalidVector[];
  };
};

const conformance = JSON.parse(
  readFileSync(CONFORMANCE_PATH, "utf8")
) as Conformance;

function toPublicInput(input: ContractInput): TargetEnvelopeInput {
  return {
    namespace: input.namespace,
    service: input.service,
    ...(input.protocol === undefined ? {} : { protocol: input.protocol }),
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(input.service_version === undefined
      ? {}
      : { serviceVersion: input.service_version }),
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(input.original_endpoint === undefined
      ? {}
      : { originalEndpoint: input.original_endpoint })
  };
}

function toContractShape(envelope: Readonly<TargetEnvelope>): ContractInput {
  return {
    namespace: envelope.namespace,
    service: envelope.service,
    ...(envelope.protocol === undefined ? {} : { protocol: envelope.protocol }),
    ...(envelope.group === undefined ? {} : { group: envelope.group }),
    ...(envelope.serviceVersion === undefined
      ? {}
      : { service_version: envelope.serviceVersion }),
    ...(envelope.method === undefined ? {} : { method: envelope.method }),
    ...(envelope.originalEndpoint === undefined
      ? {}
      : { original_endpoint: envelope.originalEndpoint })
  };
}

test("导出的契约常量与正式资产一致", () => {
  assert.equal(TARGET_ENVELOPE_VERSION, conformance.envelope_version);
  assert.equal(conformance.contract, "pole-target-envelope");
  assert.equal(conformance.contract_version, "1.0.0");
  assert.equal(DEFAULT_SIDECAR_ENDPOINT, "http://127.0.0.1:15001");
  assert.equal(existsSync(join(PROJECT_ROOT, "dist/index.js")), true);
});

test("vendored 契约资产完整且校验和一致", () => {
  const checksumLines = readFileSync(
    join(CONTRACT_ROOT, "SHA256SUMS"),
    "utf8"
  )
    .trim()
    .split("\n");
  assert.deepEqual(
    checksumLines.map((line) => line.split(/\s+/u)[1]),
    ["schema.json", "conformance.json"]
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
  assert.match(version, /^contract=pole-target-envelope$/mu);
  assert.match(version, /^version=1\.0\.0$/mu);
  assert.match(version, /^tag=thin-sdk-contract-v1\.0\.0$/mu);
  assert.match(
    version,
    /^commit=f45b0396b4680fe588a93086ceb2934d3e157d04$/mu
  );
});

for (const vector of conformance.valid) {
  test(`SDK valid 向量：${vector.name}`, () => {
    const envelope = createTargetEnvelope(toPublicInput(vector.input));
    assert.deepEqual(toContractShape(envelope), vector.normalized);
    assert.equal(Object.isFrozen(envelope), true);

    const baseHeaders = Object.fromEntries(vector.base_headers ?? []);
    const headers = encodeTargetEnvelopeHeaders(envelope, baseHeaders);
    assert.deepEqual(Object.entries(headers), vector.expected_headers);
    assert.equal(Object.isFrozen(headers), true);
  });
}

for (const vector of conformance.invalid) {
  test(`SDK invalid 向量：${vector.name}`, () => {
    assert.throws(
      () => createTargetEnvelope(toPublicInput(vector.input)),
      (error: unknown) =>
        error instanceof TargetEnvelopeError &&
        error.diagnostic === vector.diagnostic
    );
  });
}

for (const vector of conformance.language_specific_invalid) {
  test(`SDK language-specific-invalid 向量：${vector.name}`, () => {
    const invalidValue = String.fromCharCode(
      ...vector.utf16_code_units.map((codeUnit) => Number.parseInt(codeUnit, 16))
    );
    const input = {
      namespace: "default",
      service: "orders",
      [vector.field]: invalidValue
    } as ContractInput;

    assert.throws(
      () => createTargetEnvelope(toPublicInput(input)),
      (error: unknown) =>
        error instanceof TargetEnvelopeError &&
        error.diagnostic === vector.diagnostic
    );
  });
}

test("Sidecar receive 向量作为 vendored 资产结构完整", () => {
  assert.ok(conformance.sidecar_receive.valid.length > 0);
  assert.ok(conformance.sidecar_receive.invalid.length > 0);

  for (const vector of conformance.sidecar_receive.valid) {
    assert.ok(vector.name.length > 0);
    assert.ok(vector.headers.length >= 3);
    assert.equal(typeof vector.expected_envelope.namespace, "string");
    assert.equal(typeof vector.expected_envelope.service, "string");
  }
  for (const vector of conformance.sidecar_receive.invalid) {
    assert.ok(vector.name.length > 0);
    assert.ok(vector.headers.length > 0);
    assert.ok(vector.diagnostic.length > 0);
  }
});

test("编码前会重新校验伪造的信封结构", () => {
  assert.throws(
    () =>
      encodeTargetEnvelopeHeaders({
        namespace: "default",
        service: "orders",
        originalEndpoint: "orders.internal:080"
      }),
    (error: unknown) =>
      error instanceof TargetEnvelopeError &&
      error.diagnostic === "INVALID_ORIGINAL_ENDPOINT"
  );
});

test("保留名为 __proto__ 的非内部 Header", () => {
  const baseHeaders = JSON.parse(
    '{"__proto__":"safe","X-Request-ID":"request-1"}'
  ) as Record<string, string>;
  const encoded = encodeTargetEnvelopeHeaders(
    createTargetEnvelope({ namespace: "default", service: "orders" }),
    baseHeaders
  );

  assert.equal(Object.hasOwn(encoded, "__proto__"), true);
  assert.equal(encoded["__proto__"], "safe");
  assert.equal(encoded["X-Request-ID"], "request-1");
});

test("干净 npm pack 会构建并包含正式契约资产", () => {
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
    assert.equal(packedFiles.has("contract/SHA256SUMS"), true);
    assert.equal(packedFiles.has("contract/VERSION"), true);
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});
