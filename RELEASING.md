# 发布流程

`发布检查` workflow 只构建 npm 候选包并上传 Actions artifact，不发布到 npm。
正式发布前必须确认版本、契约 tag、`@pole-io` scope 所有权和 trusted publishing
配置，再通过独立审核的发布变更启用上传。
