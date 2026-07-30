# Node.js Thin SDK

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
