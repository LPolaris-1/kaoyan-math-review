# Deployment

## Production target

- Domain: `https://phecdavenus.cloud/`
- Project: `/opt/kaoyan-math-review`
- Current release: managed by `current` symlink
- Process: PM2 `kaoyan-math-review`
- App bind: `127.0.0.1:3100`
- Data: `/opt/kaoyan-math-review/shared/review.db`

当前线上行为基线是 release `20260826-122638`（161 道题 / 29 天）。canonical 分支的题目源由 `MATH_VAULT_DIR` 指向的 Vault 原档案 Markdown 提供，当前生成结果为 164 道题 / 30 天；两者不得混称。

## Release workflow

1. 在本地 canonical 分支运行 lint、Node tests、`build`、`build:selfhost` 和 `data:verify`。
2. 读取 `dist/RELEASE.json`，记录 commit、branch、built_at。
3. 服务器先备份当前 release、SQLite、WAL/SHM 和元数据。
4. 创建带时间戳的新 release，复制 bundle 和启动脚本并逐文件校验。
5. 只读启动检查通过后再切换 `current`，按授权 reload PM2。
6. 验证登录、`/review`、API、PM2、SQLite `quick_check` 和回滚路径。

本阶段重建不执行上述生产步骤；部署、重启、数据库写入和 Caddy 变更必须另行授权。

## Canonical Cutover

在 `migration/selfhost-canonical` 合并 `main` 之前，线上 release 仍是行为基线。合并后，GitHub `main` 成为未来开发和部署的唯一源码来源；不得从 production bundle、旧 Sites 仓库或旧 `coding/错题复盘站` 目录反向部署。

## Rollback

保留上一 release 和 current 指向记录。回滚只切换到已验证的上一 release 并重新验证 PM2、HTTPS 和数据读回，不修改 `shared/review.db`。
