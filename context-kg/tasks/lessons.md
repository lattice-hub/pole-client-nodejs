# Lessons

- Sidecar Session 的 `OpenSession` 是 SDK 建立的 server-streaming 长连接，Sidecar 首帧主动下发不可变 listener 表；不要把它误实现为 SDK 的 `GetListeners` 查询或每次业务请求的选址 RPC。业务客户端始终连接 Sidecar 已下发的本地协议 listener。
- 契约实现完成前必须重新读取权威文档，尤其要逐项覆盖新增的一致性向量。
- Unicode 控制字符校验直接使用 General Category `Cc`，不要依赖手写码点范围表达契约。
- 可选字段经过 Unicode trim 后为空时应视为未提供，不能生成空 Header。
- npm 组织和 GitHub 组织统一使用 `lattice-hub`；Node.js 包 scope 必须是
  `@lattice-hub`，不要从 Pole 项目名推导为 `@pole-io`。
- Thin SDK 在 specification 功能分支验证后，提交前必须将 `contract/VERSION` 和文档引用
  切换到已合并的 `develop` 集成提交；不得保留临时工作树 commit。
