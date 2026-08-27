# Production parity report

重建基线：Aliyun release `20260826-122638` 的 bundle 快照与 `phecdavenus.cloud` 阶段 3C 登录验收记录。该 release 是 161 道题 / 29 天的线上行为基线；当前 canonical source 由 `MATH_VAULT_DIR` 指向的 Vault 原档案生成，当前为 164 道题 / 30 天。目标是行为等价，不要求新构建产物 hash 与线上 hash 一致。

| 生产能力 | canonical 源码 | 测试/证据 | 状态 |
|---|---|---|---|
| Day 1/2/4/7/15/30 绝对节点 | `lib/review-schedule.mjs` | `tests/review-schedule.test.mjs` | 已确认一致 |
| correct/hard/wrong/master 状态机 | `lib/review-progress-state.mjs`、`app/api/review-progress/route.ts` | `tests/review-progress-state.test.mjs`、SQLite tests | 已确认一致 |
| `cycle_started_at` 与 `review_events` | `db/schema.ts`、`drizzle/0001_black_deadpool.sql`、`app/api/review-events/route.ts` | `tests/selfhost-sqlite.test.mjs` | 已确认一致 |
| 今日复习 | `app/review/page.tsx` | `tests/review-progress-ui.test.mjs`、线上 3C | 已确认一致 |
| 全部进度、六项统计 | `app/components/review/progress-overview.tsx` | UI tests、线上 3C | 已确认一致 |
| 单题时间轴与 Day 1 编辑 | `app/components/review/progress-overview.tsx`、`lib/review-schedule.mjs` | UI/schedule tests、线上 3C | 已确认一致 |
| 搜索/筛选/排序/mastered | `app/components/review/progress-overview.tsx`、`app/globals.css` | UI tests、线上 3C | 已确认一致 |
| self-host 认证与 loopback 启动 | `app/api/selfhost-auth/*`、`scripts/start-selfhost.mjs` | auth tests、生产架构记录 | 已确认一致 |
| N+1 请求约束 | `/review` 单次 history + progress 加载 | bundle 静态审计；线上浏览器未发现逐题请求 | 已确认，未作抓包承诺 |
| 390px 移动布局 | `app/globals.css` | 线上 390×844 无横向溢出 | 已确认 |

## Deliberate boundaries

- 未复制生产 `review.db`、WAL/SHM、`.env`、`auth.env`、日志或密钥。
- 未修改生产服务器、Caddy、PM2 或数据库。
- 未实施阶段 4A/4B。
- 旧 `coding/错题复盘站` 只作为已验收阶段 1–3 的源码参考，未把它宣布为生产仓库，也未整目录覆盖 canonical repo。

## Remaining uncertainty

当前生产源码原始来源未在服务器保留；`migration/selfhost-canonical` 是由 GitHub 旧 Sites history、已验收阶段 1–3 可维护源码、Aliyun production bundle、线上行为验收和 selfhost schema/API 现场记录重建的 canonical source candidate。合并 `main` 前，用户应审核完整 diff；合并后 GitHub `main` 才成为未来开发和部署的唯一源码来源。每个 release 仍须核对 `RELEASE.json` provenance。

## Canonical Cutover

在 migration 分支合并 `main` 之前，release `20260826-122638` 继续作为生产行为基线。合并后，禁止从 production bundle 或旧 `coding/错题复盘站` 目录反向开发/部署，也禁止在服务器直接编辑业务源码。
