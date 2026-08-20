# 考研数学错题复盘站

## 目标

每天 22:00 扫描仓库中的考研数学错题原档案，按日期生成可复盘的历史数据，并由站点提供按日浏览、筛选和展开详情的界面。

## 目录约定

- `app/`：站点页面与样式。
- `public/data/`：由扫描脚本生成的历史数据，不手工编辑。
- `scripts/`：扫描与数据生成脚本。
- `AGENTS.md`：本项目约定。

## 数据规则

- 原始输入只读：`06-Resources/学习/考研/考研数学/错题本/原档案/`。
- 日期规则：优先沿用 `history.json` 中已锁定的历史日期；新文件依次使用文件创建时间（birthtime，有效且非 1970-01-01）、文件修改时间（mtime），无法获取时不计入。不按 Frontmatter、正文或文件名推断日期。
- 每次生成都保留所有历史日期，不删除旧记录。
- 生成失败时不得覆盖上一份有效数据。

### LaTeX 导入硬门禁

- 新增或修改的原档案中的数学表达式必须先转换为 LaTeX，并使用 `$...$`、`$$...$$`，或兼容的 `\\(...\\)`、`\\[...\\]` 分隔。
- `data:build` 在写入 `public/data/history.json` 之前必须对新增或修改的源文件执行数学格式门禁；发现未分隔的纯文本/Unicode 数学式时，立即失败并报告源文件、行号、片段和转换提示。既有历史记录保持兼容，不因历史遗留格式被重新导入而阻塞。
- 门禁失败时不得自动修改 Vault 原题、不得生成或覆盖 `history.json`，也不得发布 Sites；上一份有效历史数据必须保持不变。
- `data:verify` 必须执行同一门禁，禁止通过绕过构建直接验证或发布。
- 每日 22:00 自动化遇到门禁失败时只报告阻塞文件和行号，待原题转换为 LaTeX 后再导入；不得降低、绕过或静默忽略门禁。

## 自建服务器运行模式（可选）

- 默认 `npm run build` 是 ChatGPT Sites/Cloudflare D1 构建，行为不变；自建构建用 `npm run build:selfhost`（设置 `SELF_HOSTED_BUILD=1` 并调用项目内 vinext CLI，`vite.config.ts` 只启用原生 vinext 构建，把 `cloudflare:workers` alias 到 `selfhost/cloudflare-workers.ts`）。
- 启动：`npm run start:selfhost`，默认只监听 `127.0.0.1:3100`；`HOST`/`PORT` 可覆盖。`REVIEW_DB_PATH` 必填，缺失时拒绝启动；SQLite 路径父目录自动创建，不删除/清空已有库。
- 数据库：首次启动幂等创建 `review_progress` 表与 `review_progress_due_idx` 索引（`CREATE ... IF NOT EXISTS`），不做破坏性迁移；重复启动不丢数据。既有真实进度数据不得被覆盖。
- 数据路径：`MATH_VAULT_DIR` 覆盖原档案目录，默认 `C:/Users/HUAWEI/Vault/猥琐凡人的仓库`；原档案只读，自建模式不写 Vault。
- 网页登录（可选，`SELFHOST_FORM_AUTH=1` 启用，替代 Basic Auth）：应用只提供窄认证端点 `app/api/selfhost-auth/{login,logout,check}`；认证由外层 Caddy 全局执行——`/login`、`/logout` 反代到应用，其余请求用 `forward_auth` 调 `/api/selfhost-auth/check`，验证成功后反代并注入固定 `oai-authenticated-user-email` 头。不做 OAuth、多用户或完整认证系统，不新增依赖；未启用时认证端点返回 404，Sites 默认行为不变。
- 凭据：`SELFHOST_AUTH_USERNAME`、`SELFHOST_AUTH_PASSWORD_HASH`（PBKDF2-SHA256，含版本/迭代次数/盐/摘要）、`SELFHOST_SESSION_SECRET`（HMAC-SHA256 会话签名）。由 `scripts/configure-selfhost-auth.mjs` 从 stdin 读密码生成 `auth.env`（0600、原子写、不含明文密码，内含 `SELFHOST_FORM_AUTH=1` 自动启用网页登录）；`start:selfhost` 从 `REVIEW_DB_PATH` 同目录 `auth.env`（或 `SELFHOST_AUTH_ENV_FILE`）加载且不覆盖已有环境变量。任一缺失必须 fail closed（拒绝启动或请求 500），secret 不得进入仓库、日志或测试输出。
- 信任边界：自建服务必须只绑定回环地址（loopback），由外层 Caddy 负责 TLS 终止与 forward_auth；会话 Cookie `__Host-kaoyan_session`（HttpOnly、Secure、SameSite=Lax、Path=/）仅在 HTTPS 下有效。不得把服务直接暴露到网络，不打印密码或环境变量。

## 验证

- `npm run build`
- `npm run build:selfhost`
- `npm run data:build`
- `npm run data:verify`
- `npm run lint`
- `node --test --test-isolation=none tests/*.test.mjs`
