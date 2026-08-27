# Architecture

## Runtime

生产链路为：

`Caddy (TLS + forward_auth) → vinext self-host server → SQLite`

PM2 启动 `scripts/start-selfhost.mjs`，应用默认只监听 `127.0.0.1:3100`。Caddy 负责外部 HTTPS 与认证边界；应用只提供窄认证端点和复习 API。

## Data flow

`Vault 原档案（只读） → scripts/build-review.mjs → public/data/history.json`

题目内容的 Source of Truth 是 `MATH_VAULT_DIR` 指向的错题原档案 Markdown；`history.json` 是由正式生成器产生的、版本化的构建输入/静态数据，禁止手工编辑。当前 canonical source 生成结果为 164 道题、30 天；生产 release `20260826-122638` 的 161 道题、29 天只作为线上行为基线。

登录后的 `/review` 一次读取 history 和 `/api/review-progress`，在客户端完成今日队列、全部进度、时间轴和四象限展示。复习提交统一进入 `/api/review-progress`，由 `scheduleReview()` 产生下一状态并写入 `review_events`。

## Source/build/data boundary

- `app/`、`lib/`、`db/`、`selfhost/`、`scripts/`、`tests/`、`drizzle/`：可维护源码
- `dist/`、`.next/`：可重新生成的构建产物
- `review.db`、WAL/SHM、`auth.env`、日志和密钥：生产数据/凭据，禁止进入 Git

ChatGPT Sites/Cloudflare 兼容入口可保留在源码中，并通过显式 `npm run build:sites` 使用；canonical 默认 `npm run build` 和生产运行模式是 self-host，不得把 Sites 认证或 D1 当作生产路径。

## Canonical Cutover

在 `migration/selfhost-canonical` 合并 `main` 之前，生产 release `20260826-122638` 仍是线上基线。合并后，GitHub `main` 成为未来开发和部署的唯一源码来源；禁止从 production bundle 或旧 `coding/错题复盘站` 目录反向开发/部署，也禁止在服务器直接编辑业务源码。
