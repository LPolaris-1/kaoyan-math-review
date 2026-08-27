# Operations

## Local commands

```bash
npm ci
npm run lint
node --test --test-isolation=none tests/*.test.mjs
npm run build
npm run build:sites  # 仅用于旧 Sites 兼容构建
npm run build:selfhost
npm run data:verify
```

本地 self-host 测试必须使用临时 SQLite，不得指向生产 `review.db`：

```bash
REVIEW_DB_PATH=./work/local-review.db npm run start:selfhost
```

## Read-only production checks

```bash
readlink -f /opt/kaoyan-math-review/current
pm2 describe kaoyan-math-review
sqlite3 -readonly /opt/kaoyan-math-review/shared/review.db 'PRAGMA quick_check;'
```

不要读取或输出 `.env`、`auth.env`、私钥、Token、密码或会话 Cookie。不要用 HTTP 200 单独判定部署成功；必须结合认证行为、数据读回、PM2 和错误日志。

## Incident boundary

发现 schema 错误、重复 500、数据计数异常或 PM2 不稳定时，停止后续写入与部署，保留现场证据并先报告。不要通过注释代码、直接改库或强制切换 release 绕过问题。
