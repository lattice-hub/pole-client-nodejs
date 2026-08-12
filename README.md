# @lattice-hub/pole-client-nodejs

Pole Node.js Thin SDK 的框架无关核心包。它只承担两项职责：

1. 通过 gRPC over Unix Domain Socket 建立控制会话，接收 Pole Sidecar 主动下发的本地 listener，并登记本地服务；
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
const registrationId = sidecar.registerLocalService({
  namespace: "production",
  service: "catalog",
  protocol: "grpc",
  localPort: 50051
});
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
- SDK 调用 `SidecarSessionService/OpenControlSession` 并保持双向控制流；第一条客户端
  事件固定为 `ClientHello`。
- Sidecar 必须在首帧下发 HTTP、gRPC、Dubbo、Thrift 的完整 listener 表；SDK 严格
  校验协议唯一性与端口范围后一次性安装不可变快照。
- `registerLocalService` 接收 `namespace`、`service`、`protocol`、`localPort` 与可选
  `registrationId`，返回稳定的注册 ID；`unregisterLocalService` 会删除 desired
  registration 并在活跃流上发送注销事件。重连时 SDK 先发送 `ClientHello`，随后重放
  全部 desired registrations。
- `localServiceStatus(registrationId)` 返回最新的 `registered`、`unregistered` 或
  `rejected` 状态；断流时这些会话状态立即失效。
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

## TrafficContext v1

`TrafficContext` 是唯一的流量标签模型，`campaign`、`lane` 和 `bucket` 均可选，且不通过
`trace-id` 关联灰度。Node 默认使用 `AsyncLocalStorage`：`attachTrafficContext` 返回可关闭
scope，`close()` 会恢复上一个上下文；`resetTrafficContext` 清空当前原生上下文。
`extractTrafficContext` 只解码 carrier，`injectTrafficContext` 的显式参数优先，否则读取
`currentTrafficContext()`。

```ts
import {
  attachTrafficContext,
  createTrafficContext,
  createTargetService,
  encodeTargetServiceMetadataWithTrafficContext
} from "@lattice-hub/pole-client-nodejs";

const scope = attachTrafficContext(createTrafficContext({ lane: "gray" }));
try {
  const metadata = encodeTargetServiceMetadataWithTrafficContext(
    createTargetService({ namespace: "production", service: "catalog" }),
    { authorization: "Bearer token" }
  );
  // HTTP、Thrift-over-HTTP、gRPC metadata 和 Dubbo attachment 复用该装配结果。
} finally {
  scope.close();
}
```

若应用已安装 `@opentelemetry/api`，可将其 API 对象传入
`createOpenTelemetryTrafficContextAdapter` 或
`installOpenTelemetryTrafficContextAdapter`，adapter 会把领域值及流量成员写入 OTel Context/
Baggage。Node 的 OTel 等价 attach 是 `runWithTrafficContext(context, operation)`：SDK 在 callback
期间调用真实 `api.context.with`，因此 `api.context.active()` 和标准 Propagator 可以直接读取当前
OTel Baggage。`attachTrafficContext` 始终使用 native `AsyncLocalStorage` 并返回 closeable scope；
OTel callback 会屏蔽进入前的 native scope，但 callback 内新建的 native attach 仍可显式覆盖
`currentTrafficContext()`。公开 adapter 类型与真实 `@opentelemetry/api` 模块结构兼容，核心包
不产生运行时硬依赖。
自动框架 hook、自动 OTel propagator 安装不在本次范围内；框架 adapter 应在入口 extract 后
建立请求 scope，并在出站调用使用 `encodeTargetServiceMetadataWithTrafficContext`。完整 wire 契约位于
`contract/traffic-context/v1/`。

## 契约资产

`contract/` vendor 了 TargetService、TrafficContext 的 `schema.json`、`conformance.json` 和
Sidecar 的 `bootstrap.proto`；`SHA256SUMS` 覆盖这三份文件。`contract/VERSION`
固定 Sidecar Session/TargetService wire 版本、已合并的 specification `develop`
不可变提交。正式端到端兼容组合仍以 specification 的
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
安装、严格校验、服务注册状态、断流失效、注册重放和打包资产；它不替代与真实 Pole Sidecar 的
端到端互操作验证。

## 许可证

BSD 3-Clause License，详见 `LICENSE`。
