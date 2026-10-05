# Database

## SQLite boundary

生产数据库位于 `/opt/kaoyan-math-review/shared/review.db`，只由 self-host 运行时通过 `REVIEW_DB_PATH` 使用。源码仓库不包含数据库副本、WAL/SHM 或认证文件。

## Canonical schema

- `review_progress`：每个用户/题目的 mastery、考频、四阶段调度状态、下一次复习日期、最近结果和 `cycle_started_at`
- `review_events`：实际复习行为及 before/after 阶段、原始目标日和计划日期；历史行不因调度升级而改写
- 迁移文件位于 `drizzle/`；启动时只允许幂等补齐缺失结构，不以线上手工 ALTER 代替迁移历史

### Schedule schema version

- `PRAGMA user_version=2` 表示四阶段调度（Day 1/4/7/30）。self-host 对空的 `review_progress` 表自动标记为 2；对 `user_version=0` 的非空数据库拒绝启动，避免把旧阶段按新语义直接解释。
- 旧六节点数据使用 `npm run db:migrate:schedule-v2 -- --dry-run` 预览、再用 `--apply` 执行。脚本只更新 `review_progress.review_stage` 和必要的 `next_review_date`，不改 `review_events`，不新增业务表；成功后在同一事务中写入 `user_version=2`。
- 迁移接受的阶段映射为 `0→0`、`1/2→1`、`3→2`、`4/5→3`、`6→4`。标准旧计划日期才会重算为新的绝对 Day 4/7/30；hard、补强和逾期补排日期保留。缺失周期锚点（除 stage 0 外）、非法日期或非法阶段会使整批停止。

## State semantics

- 首次 `correct` 建立 Day 1，下一次在实际完成日 3 天后进入 Day 4
- `correct` 按实际完成日滚动计算下一节点：Day 4 → Day 7 间隔 3 天，Day 7 → Day 30 间隔 23 天；逾期完成不会把后续节点压到次日
- Day 30 后进入长期巩固，并按实际复习日每 30 天重复
- `hard` 保留周期和阶段并安排次日补强
- `wrong` 清空当前周期，下一次 `correct` 建立新 Day 1
- `mastered` 题目不进入今日队列

任何生产 schema 变化、迁移或直接 SQL 写入都需要独立授权。验收优先使用正式 API/UI，数据库仅做只读回读。
