# @lattice-hub/pole-client-nodejs

Pole Node.js Thin SDK 的框架无关核心包。它只承担两项职责：

1. 通过 gRPC over Unix Domain Socket 接收 Pole Sidecar 主动下发的本地 listener；
2. 创建 `TargetService v1`，并向业务请求注入规范的目标服务元信息。

业务请求仍使用原始 HTTP、gRPC、Dubbo 或 Thrift 协议，连接到 Sidecar 下发的
`127.0.0.1:{port}`。SDK 不进行服务发现、实例选址，也不内置任何 listener 端口。

## 安装

```bash
npm install @lattice-hub/pole-client-nodejs
```

运行时依赖为官方 `@grpc/grpc-js` 与 `@grpc/proto-loader`；SDK 直接使用 vendor 的
`bootstrap.proto`，不定义私有 bootstrap 协议。

## 使用

```ts
import {
  connectSidecarSession,
  createTargetService,
  encodeTargetServiceMetadata
} from "@lattice-hub/pole-client-nodejs";

const sidecar = await connectSidecarSession();
const target = createTargetService({
  namespace: "production",
  service: "catalog"
});

const headers = encodeTargetServiceMetadata(target, {
  authorization: "Bearer token"
});

const response = await fetch(
  `http://${sidecar.listenerAddress("http")}/catalog.Product/GetProduct`,
  { method: "POST", headers, body: requestBody }
);

sidecar.close();
```

`encodeTargetServiceMetadata` 返回普通不可变键值对象，可直接用于 HTTP Header 和
Thrift-over-HTTP Header。gRPC adapter 应将这两个键写入官方 `grpc.Metadata`，Dubbo
adapter 应将它们写入官方 invocation attachment。调用方预设的同名键会被大小写
不敏感地删除并由 SDK 重写。

## Bootstrap

- 默认 UDS：`/var/run/pole/sidecar/bootstrap.sock`
- 开发或特殊部署覆盖：`POLE_SIDECAR_SOCKET`
- SDK 调用 `SidecarSessionService/OpenSession` 并保持 server-streaming 会话。
- Sidecar 必须在首帧下发 HTTP、gRPC、Dubbo、Thrift 的完整 listener 表；SDK 严格
  校验协议唯一性与端口范围后一次性安装不可变快照。
- 初始化阶段采用有界指数退避；超过 `initializationTimeoutMs`（默认 10 秒）即失败。
- 会话断开时，SDK 立即使快照失效，`listenerAddress` 抛出
  `SidecarUnavailableError`；后台重连仅在收到新首帧后恢复地址。

因此应用不应缓存 `listenerAddress` 的返回值，也不得在 Sidecar 不可用时绕过它直连
真实实例。每个 Node.js worker 应创建并关闭自己的 `SidecarSession`；单个 session 的
地址快照是冻结对象并通过一次引用替换，对并发调用不会暴露部分更新。

## TargetService v1

`TargetService` 只包含必填的 `namespace` 与 `service`。创建时拒绝孤立 UTF-16
surrogate 和 Unicode `Cc` 控制字符，按 Unicode 15.1 `White_Space` 去除首尾空白，
并拒绝空字段。线路值对 UTF-8 字节进行 canonical percent 编码：可打印 ASCII（除
`%` 与 `,`）原样保留，其余字节编码为大写 `%HH`。

| 键 | 字段 |
| --- | --- |
| `latticehub-target-namespace` | `namespace` |
| `latticehub-target-service` | `service` |

Sidecar 消费后必须删除这两个内部键，不得转发给真实服务。v1 以 Kubernetes Pod 为
信任边界，不防御已被攻陷的同 Pod 进程。

## 契约资产

`contract/` vendor 了 TargetService 的 `schema.json`、`conformance.json` 和
Sidecar 的 `bootstrap.proto`；`SHA256SUMS` 覆盖这三份文件。`contract/VERSION`
固定 Sidecar Session/TargetService wire 版本、specification
`develop` 不可变提交。正式端到端兼容组合仍以 specification 的
compatibility matrix 为准。

## 开发

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run prepack
```

本包支持 Node.js 18、20、22。测试启动真实的 `@grpc/grpc-js` UDS 服务，验证首帧
安装、严格校验、断流失效、重连恢复和打包资产；它不替代与真实 Pole Sidecar 的
端到端互操作验证。

## 许可证

BSD 3-Clause License，详见 `LICENSE`。
