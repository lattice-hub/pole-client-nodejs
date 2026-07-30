# Lessons

- 契约实现完成前必须重新读取权威文档，尤其要逐项覆盖新增的一致性向量。
- Unicode 控制字符校验直接使用 General Category `Cc`，不要依赖手写码点范围表达契约。
- 可选字段经过 Unicode trim 后为空时应视为未提供，不能生成空 Header。
