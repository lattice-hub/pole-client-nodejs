# Lessons

- Sidecar Session 的 `OpenSession` 是 SDK 建立的 server-streaming 长连接，Sidecar 首帧主动下发不可变 listener 表；不要把它误实现为 SDK 的 `GetListeners` 查询或每次业务请求的选址 RPC。业务客户端始终连接 Sidecar 已下发的本地协议 listener。
- 契约实现完成前必须重新读取权威文档，尤其要逐项覆盖新增的一致性向量。
- Unicode 控制字符校验直接使用 General Category `Cc`，不要依赖手写码点范围表达契约。
- 可选字段经过 Unicode trim 后为空时应视为未提供，不能生成空 Header。
