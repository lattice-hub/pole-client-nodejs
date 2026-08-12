# Node.js Thin SDK

## 2026-08-06 TrafficContext v1

- [x] 核对 TargetService 编码入口与契约资产
- [x] 先写 TrafficContext 传播与作用域测试
- [x] 实现 AsyncLocalStorage 原生存储和可选 OTel adapter
- [x] 接入 TargetService metadata 公共编码路径
- [x] 复制 v1 契约、更新 README 并完成全量验证
- [x] 复审 W3C OWS、外部空值与输入限制兼容性
- [x] 二轮复审：空上下文、大小写与 OTel 统一 API 语义
- [x] 同步新版 conformance 空上下文清理向量与校验和
- [x] 注入清理全部精确小写保留前缀，extract 保持未知字段拒绝
- [x] 修复 native 外层与 OTel 子 scope 的读取优先级
- [x] 对齐真实 `@opentelemetry/api` 模块类型与顶层 `createContextKey`
- [x] 分离 native closeable attach 与 OTel callback scope
- [x] 执行全部 TrafficContext conformance 向量并校验 diagnostic
- [x] 通过真实 `api.context.active()` 验证 OTel Baggage current

### Review

- `TrafficContext` 使用 AsyncLocalStorage scope/reset；可选 OTel adapter 由调用方传入
  `@opentelemetry/api` 对象，核心包不产生 OTel 硬依赖。
- Baggage 输出保留外部成员、覆盖旧保留成员，拒绝非法 reserved 字段并在无成员时删除 carrier；
  Node 测试同时执行 vendored conformance 向量。
- Baggage parser 按 W3C 支持 SP/HTAB OWS、外部空值、合法 property，并拒绝非法 token/
  baggage-octet；多 Header 按逗号合并后在输入阶段限制 8192 bytes。
- 二轮复审后，空 TrafficContext 与 version-only carrier 合法；native attach 使用
  `AsyncLocalStorage`，OTel current 由 callback scope 承载。
- `encodeTargetServiceMetadataWithTrafficContext` 在同一个出站元信息装配点写入
  TargetService 和下游可传递的 Baggage，显式 context 优先。
- 已执行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run prepack`、
  `npm pack --dry-run --json` 和 `git diff --check`。
- 四轮复审后，公开接口使用与真实 `@opentelemetry/api` 精确兼容的结构类型，
  `createContextKey` 从模块顶层读取；OTel run 清理全部精确小写保留前缀，恢复到含未知保留键的
  Baggage 时 current 拒绝该上下文。conformance 测试完整执行 valid、sidecar receive
  valid/invalid 并精确比对 diagnostic。
- 五轮复审纠正 Node OTel 作用域语义：`attachTrafficContext` 始终是 native closeable scope；
  `runWithTrafficContext` 才通过真实 `api.context.with` 建立标准 OTel callback scope。run 屏蔽进入前
  的 native current，operation 内新建的 attach 可覆盖领域 current，但不会篡改标准 OTel Baggage；
  测试直接读取 `api.context.active()`，不再依赖 adapter 私有 context。
- Specification 已合入 `develop`；`contract/VERSION` 固定到权威提交
  `67b101bb6e3906b4337affefd33ef778cec692b3`，但该 SDK 尚未发布，因此保留
  `source_state=unreleased-develop`。TrafficContext 四份 vendored 资产和
  `bootstrap.proto` 已逐字节比对该提交；不依赖工作区中可能滞后的 Sidecar 克隆。
- 复核后将 `sidecar_session_wire_version` 从遗留的 `2` 修正为 `1`，并同步契约测试断言。
  权威 `thin-sdk/README.md` 明确列出 Sidecar Session wire version `1`；Node vendored 的
  `bootstrap.proto` 与该提交的 `api/v1/sidecar/bootstrap.proto` 完全一致，且 Go、Java、Python、
  C++、C# 的 `contract/VERSION` 同样记录 `1`。现有 Node control-session API 的新增能力不能单独
  证明 wire version 应升级。
- 本轮复审执行 `npm run lint`、`npm run typecheck`、`npm test`（25/25）、`npm run prepack`、
  `npm pack --dry-run --json`、`git diff --check`；vendored TrafficContext 的
  `schema.json`/`conformance.json` 均通过其 SHA256SUMS 校验。`context-kg` lint 仍因仓库既有的
  tasks 页面无 frontmatter、缺少 `_meta/index.md` 而失败，未为一次 SDK 任务改造知识库结构。

## 2026-08-06 Sidecar Service Session v2

- [x] 核对 `OpenControlSession` 双向流契约与现有会话实现
- [x] vendor v2 proto 和契约版本
- [x] 迁移会话、注册重放与状态处理
- [x] 更新公开 API、README 和真实 UDS 测试
- [x] 运行静态检查、测试、打包与差异审查

### Review

- `bootstrap.proto`、校验和与版本定位均固定到 specification `develop` 的合并提交
  `2642bc29c0a512f4da84ec4eb862b1e1ceee9833`。
- `OpenControlSession` 首发 `ClientHello`，首帧原子安装 listener snapshot；desired
  registrations 会在重连后按 `ClientHello` 之后的顺序重放，并公开注册、注销和状态查询 API。
- `npm run lint`、`npm run typecheck`、`npm test`（17/17）、`npm run prepack`、
  `npm pack --dry-run --json` 与 `git diff --check` 均通过。

## Sidecar Session v1 与 TargetService v1

- [x] 检查适用约束、Git 状态与现有 API
- [x] 核对 specification 中的 TargetService 与 bootstrap 契约
- [x] vendor 新契约资产和 bootstrap.proto
- [x] 实现 UDS OpenSession、失效与重连
- [x] 迁移 TargetService 与业务元信息 API
- [x] 补齐会话、并发快照与契约向量测试
- [x] 运行 lint、typecheck、test 与 prepack
- [x] 记录审查结论与已知限制

### Review

- 旧 `TargetEnvelope`、`x-pole-*` 键和固定 Sidecar HTTP endpoint 已从公开 API 与契约资产移除；新 API 只导出 `TargetService`、元信息编码及 `SidecarSession`。
- `SidecarSession` 通过 `@grpc/grpc-js` 读取 vendored `bootstrap.proto`，经 UDS 的 `OpenSession` server stream 接收首帧；完整四协议表校验成功才会安装冻结地址快照。
- 断流会同步清空快照，地址读取快速失败；后台按有界指数退避重连，新的有效首帧才恢复业务地址。Node.js 单个 event loop 中通过一次不可变引用替换避免读取到部分更新；Worker 之间必须各自建会话。
- `npm run lint`、`npm run typecheck`、`npm test`（15/15）、`npm run prepack`、`npm pack --dry-run --json` 与 `git diff --check` 均通过；测试使用真实 `@grpc/grpc-js` UDS server，覆盖环境变量覆盖、首帧、失效、重连和超时。
- `TargetService v1` 已由 specification `v0.1.0-ALPHA.39` 发布；当前 `bootstrap.proto` 固定到后续 `develop`
  发布；`contract/VERSION` 固定其不可变 tag 与 commit。正式互操作组合仍以
  specification compatibility matrix 的精确证据为准。

- [x] 核对 Thin SDK 契约与工程约束
- [x] 设计不可变 TargetEnvelope 公共 API
- [x] 实现字段规范化、校验与 Header 编码
- [x] 补充单元测试、README 和许可证
- [x] 运行安装、测试与构建验证

## Review

- `npm install` 成功，审计结果为 0 个漏洞。
- `npm test` 通过 11/11 个测试，覆盖最新契约的全部一致性向量。
- `npm run build` 成功生成 ESM JavaScript 和 TypeScript 声明文件。
- `npm pack --dry-run` 成功，发布包只包含 README、LICENSE、package.json 和 dist。
- 包含 0 个运行时依赖，未创建 Git 仓库或提交。

## 2026-07-31 发布安全修复

- [x] 核对契约、公共 API 与发布链路
- [x] 将公共字段改为 `serviceVersion`、`originalEndpoint`
- [x] 编码前重新规范化并校验目标信封
- [x] 拒绝 host 中的 Unicode 空白和保留字符
- [x] 增加 `prepack` 与仓库元数据
- [x] 改为通过构建后的包入口测试
- [x] 覆盖伪造注入、非法 host、干净打包
- [x] 运行 `npm test`、`npm run build`、`npm pack`

### Review

- 公共 TypeScript API 使用 `serviceVersion`、`originalEndpoint`，Header 线路格式保持不变。
- `encodeTargetEnvelopeHeaders` 通过 `createTargetEnvelope` 重新规范化和校验任意传入结构，伪造对象无法绕过 `Cc` 控制字符及 endpoint 校验。
- 非括号 host 拒绝 Unicode `White_Space` 与 `/`、`\`、`[`、`]`、`@`、`?`、`#`。
- 测试通过包 self-reference 消费 `dist`，并在无 `dist` 的临时目录验证 `prepack` 会构建可发布入口。
- `npm test` 通过 14/14，`npm run build`、`npm pack --json` 和实际包入口导入冒烟均通过。
- 已清理测试目录、CodeGraph 索引和 `.tgz`，保留本次构建生成的 `dist`；未初始化 Git 或提交。

## 2026-07-31 正式 Thin SDK 契约接入

- [x] 核对正式 tag 与 specification commit
- [x] vendoring Schema、向量、校验和与版本定位
- [x] 实现 Unicode scalar 与精确 White_Space
- [x] 实现 canonical endpoint 与 Header 编码
- [x] 以语言原生测试执行全部 SDK 向量
- [x] 校验 Sidecar receive 资产结构
- [x] 更新 lattice-hub URL 与契约来源说明
- [x] 增加 CI、Dependabot、CODEOWNERS 与治理文档
- [x] 运行测试、构建和发布包验证

### Review

- 契约来源固定为 `thin-sdk-contract-v1.0.0` 和完整 commit `f45b0396b4680fe588a93086ceb2934d3e157d04`，vendored JSON 与 specification 源文件逐字节一致，`SHA256SUMS` 校验通过。
- 实现拒绝孤立 UTF-16 surrogate，精确使用 Unicode 15.1 `White_Space`，拒绝 endpoint 端口前导零、zone identifier 和非法 host。
- Header 值按 UTF-8 字节执行 canonical `%HH` 编码，保留 base Header 输入顺序，并大小写不敏感地替换 v1 内部 Header。
- `npm test` 通过 37/37 个测试，完整执行 9 个 valid、20 个 invalid、2 个 language-specific-invalid 向量，并验证 10 个 Sidecar receive 向量结构。
- `npm run build` 与 `npm pack --dry-run --json` 通过，发布包包含 `dist` 和完整 `contract/` 资产。
- CI 覆盖 Node.js 18、20、22；未初始化 Git、提交或推送。
- 最终审查补充 `__proto__` base Header 回归测试，并增加只构建、不发布的手动
  release-check。

## 2026-08-03 npm Trusted Publishing

- [x] 配置 npm OIDC 与 GitHub Release 工作流
- [x] 验证版本 gate、测试与发布包
- [x] 提交并推送发布配置

### Review

- GitHub Release 标签必须与 `package.json` 版本一致；发布 job 使用 Node 24、
  npm Trusted Publishing OIDC 和 public scope 配置，不保存长期 npm token。
- `npm run lint`、`npm run typecheck`、15 个测试及 `npm pack --dry-run --json`
  全部通过。
- npm registry 当前尚无 `@lattice-hub/pole-client-nodejs`，需要先完成一次包初始化发布，
  再在包设置中绑定 Trusted Publisher。

## 2026-08-03 npm scope 迁移

- [x] 扫描旧 `@pole-io` npm scope 引用
- [x] 将包名、锁文件、README 与自引用测试迁移到 `@lattice-hub`
- [x] 更新发布文档和经验记录
- [x] 运行测试与发布包验证
- [x] 提交并推送迁移改动

### Review

- `package.json`、lockfile、README、测试自引用和发布文档均使用
  `@lattice-hub/pole-client-nodejs`；vendored proto 的 Go package 保持契约原文。
- `npm run lint`、`npm run typecheck`、15 个测试和 `npm pack --dry-run --json`
  全部通过；候选包确认为 `@lattice-hub/pole-client-nodejs@0.2.0`，包含 20 个文件。
- npm registry 当前返回 404，仍需由 `lattice-hub` npm organization 成员完成首次
  `npm publish --access public`。
- GitHub 远端 Node.js 18/20/22 矩阵全绿；同时将 CI 和 release-check 的
  `checkout`、`setup-node` 升级到 v6，消除 Node 20 action runtime 弃用警告。
