# @pole-io/pole-client-nodejs

Pole Node.js Thin SDK 的框架无关核心包。它按照正式 `TargetEnvelope v1`
契约创建目标信封，并编码发送给本地 Pole Sidecar 的 HTTP Header。

## 契约来源

仓库 `contract/` vendoring 自
[`lattice-hub/specification`](https://github.com/lattice-hub/specification)
的正式 tag `thin-sdk-contract-v1.0.0`，对应完整 commit
`f45b0396b4680fe588a93086ceb2934d3e157d04`。`contract/VERSION` 记录来源，
`contract/SHA256SUMS` 用于验证 Schema 和一致性向量未发生漂移。

语言原生测试会读取并执行全部 SDK valid、invalid 与
language-specific-invalid 向量；`sidecar_receive` 向量仅验证 vendored
资产结构，不在 SDK 中实现 Sidecar 接收端。

Pole Sidecar 尚未完成对应 listener 的端到端验证，因此当前版本只声明契约核心
兼容，不声明 Thin SDK 到 Sidecar 已经生产就绪。

## 安装

```bash
npm install @pole-io/pole-client-nodejs
```

## 使用

```ts
import {
  DEFAULT_SIDECAR_ENDPOINT,
  createTargetEnvelope,
  encodeTargetEnvelopeHeaders
} from "@pole-io/pole-client-nodejs";

const target = createTargetEnvelope({
  namespace: "production",
  service: "catalog",
  protocol: "grpc",
  method: "GetProduct",
  serviceVersion: "v1",
  originalEndpoint: "catalog.internal:8080"
});

const headers = encodeTargetEnvelopeHeaders(target, {
  authorization: "Bearer token"
});

const response = await fetch(
  `${DEFAULT_SIDECAR_ENDPOINT}/catalog.Product/GetProduct`,
  {
    method: "POST",
    headers,
    body: requestBody
  }
);
```

`createTargetEnvelope` 按契约精确处理 Unicode scalar、Unicode 15.1
`White_Space`、控制字符和 `originalEndpoint`。公共 API 使用惯用的
`serviceVersion`、`originalEndpoint`，编码时映射到契约字段。

`encodeTargetEnvelopeHeaders` 会重新校验目标信封，按输入顺序保留非内部 base
Header，大小写不敏感地替换 v1 内部 Header，并采用 canonical UTF-8 `%HH`
线路编码。返回的目标信封和 Header 对象均被冻结。

## 开发

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

本包支持 Node.js 18、20、22，无运行时依赖，测试使用内置 `node:test`。

## 许可证

BSD 3-Clause License，详见 `LICENSE`。
