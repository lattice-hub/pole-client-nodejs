# 发布流程

`发布检查` workflow 只构建 npm 候选包并上传 Actions artifact，不发布到 npm。

首次发布需要由拥有 `@lattice-hub` scope 权限的维护者执行
`npm publish --access public`，随后在 npm 包设置中绑定 `release.yml`、`npm`
Environment 和 `npm publish` 权限的 Trusted Publisher。

后续发布必须先更新 `package.json` 版本，再创建完全匹配的 `vX.Y.Z` GitHub
Release；`发布到 npm` workflow 会使用 OIDC 完成发布，不需要长期 npm token。
