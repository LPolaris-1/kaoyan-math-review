# Database

## SQLite boundary

生产数据库位于 `/opt/kaoyan-math-review/shared/review.db`，只由 self-host 运行时通过 `REVIEW_DB_PATH` 使用。源码仓库不包含数据库副本、WAL/SHM 或认证文件。

## Canonical schema

- `review_progress`：每个用户/题目的 mastery、考频、阶段、下一次复习日期、最近结果和 `cycle_started_at`
- `review_events`：实际复习行为及 before/after 阶段、目标日和计划日期
- 迁移文件位于 `drizzle/`；启动时只允许幂等补齐缺失结构，不以线上手工 ALTER 代替迁移历史

## State semantics

- 首次 `correct` 建立 Day 1
- `hard` 保留周期并按现有调度规则补强
- `wrong` 清空当前周期，下一次 `correct` 建立新 Day 1
- `mastered` 题目不进入今日队列

任何生产 schema 变化、迁移或直接 SQL 写入都需要独立授权。验收优先使用正式 API/UI，数据库仅做只读回读。
