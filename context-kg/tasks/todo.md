# Node.js Thin SDK

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
