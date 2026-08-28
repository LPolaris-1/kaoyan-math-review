# Deployment

## Production target

- Domain: `https://phecdavenus.cloud/`
- Project: `/opt/kaoyan-math-review`
- Current release: managed by `current` symlink
- Process: PM2 `kaoyan-math-review`
- App bind: `127.0.0.1:3100`
- Data: `/opt/kaoyan-math-review/shared/review.db`

线上 release 由 `current` symlink 唯一决定；部署记录必须同时记录 `readlink -f current` 和 `dist/RELEASE.json`。canonical 分支的题目源由 `MATH_VAULT_DIR` 指向的 Vault 原档案 Markdown 提供，当前生成结果为 164 道题 / 30 天；生产与 canonical 数据不得混称。

## Release workflow

正式 canonical production 流程为：

`Git main → build:selfhost → RELEASE.json → release:verify → smoke:selfhost → upload immutable release → DB backup → provenance verify → current atomic switch → PM2 reload → localhost smoke → HTTPS smoke → DB quick_check → logs → rollback if needed`

1. 在本地 canonical `main` 运行 lint、Node tests、`build:selfhost`、`release:verify`、`smoke:selfhost`、`data:verify` 和 `data:check`。
   `build:sites` 是兼容性检查；它与 selfhost 共用 `dist/`，若执行过，必须最后再次运行 `build:selfhost`，再执行 `release:verify` 和 `smoke:selfhost`。
2. 读取 `dist/RELEASE.json`，确认 `git_commit` 与 `git rev-parse HEAD` 一致，`branch=main`、`mode=selfhost`。
3. `release:verify` 必须检查 `dist/`、`dist/RELEASE.json`、`dist/client/assets/`、`dist/server/`、package 元数据、`scripts/start-selfhost.mjs` 及其本地 runtime imports（包括 `selfhost/static-assets.mjs`）。`node_modules`、数据库、认证文件、日志和 secrets 不是 artifact 源文件。
4. 服务器先记录当前 release、PM2、磁盘、SQLite `quick_check`、行数和 schema；使用 SQLite backup 创建可验证的数据库副本。
5. 创建全新带时间戳的 immutable release，上传已通过本地检查的 artifact；不得在服务器编辑源码或执行 `npm install`。
6. 上传后先核对新 release 的必需文件和 `RELEASE.json` provenance，再以临时 symlink + `mv -Tf` 原子切换 `current`，按现有架构 reload PM2。
7. 切换后验证本机 `/`、`/review`、`/data/history.json`、实际 JS/CSS assets、HTTPS、PM2、SQLite `quick_check`、数据行数和最近日志；认证保护下的未登录 401/303 需按现有 Caddy 规则解释。

服务器不是 source of truth。源码只来自 GitHub canonical `main`；生产服务器不得直接修改业务源码。部署、重启、数据库备份/写入和 Caddy 变更必须有明确授权。

### Deployment lesson

首次 canonical deployment 曾因 release package 遗漏 runtime dependency `selfhost/static-assets.mjs` 在 production switch 后启动失败，随后立即 rollback 并补齐文件。规则：所有 release 必须在上传前通过 runtime dependency completeness check。

## Canonical Cutover

在 `migration/selfhost-canonical` 合并 `main` 之前，线上 release 仍是行为基线。合并后，GitHub `main` 成为未来开发和部署的唯一源码来源；不得从 production bundle、旧 Sites 仓库或旧 `coding/错题复盘站` 目录反向部署。

## Rollback

标准回滚只切 active immutable release，不恢复 Git：

```bash
OLD_RELEASE="/opt/kaoyan-math-review/releases/<known-good-release>"
ln -sfn "$OLD_RELEASE" /opt/kaoyan-math-review/current
pm2 reload kaoyan-math-review
```

结合当前 PM2 架构，回滚后必须重新验证 `readlink -f current`、PM2 online、localhost/HTTPS smoke 和数据读回。数据库 rollback 是独立的高风险操作，普通应用 release rollback 不自动执行。
