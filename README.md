# 考研数学 · 错题复盘站

本地复盘网站。它读取 Vault 中的考研数学错题原档案，按日期生成历史记录，网页支持日期切换、学科筛选、关键词搜索和逐题展开。

## 使用

```bash
npm run data:build
npm run dev
```

浏览器打开终端输出的本地地址即可。每天 22:00 的 Codex 定时任务会自动运行 `npm run data:build`。

## 数据约定

- 原始输入：`06-Resources/学习/考研/考研数学/错题本/原档案/`
- 生成数据：`public/data/history.json`
- 日期识别：优先沿用 `history.json` 中已锁定的历史日期；新文件依次使用文件创建时间（birthtime，有效且非 1970-01-01）→ 文件修改时间（mtime）；无法获取时不计入
- 原档案只读，历史数据全量重建且不删除旧日期

## 自建服务器运行模式（可选）

canonical 默认链路是 Aliyun self-host：`npm run build` 生成原生 vinext/SQLite 产物；旧 ChatGPT Sites/Cloudflare D1 构建仅通过显式 `npm run build:sites` 保留。self-host 在本机用 Node 22+ 原生服务器运行，适合放在 Caddy 反向代理之后。

```bash
# 构建（原生 vinext Node 产物，不包含 Sites/Cloudflare 插件）
npm run build:selfhost

# 启动（默认只监听 127.0.0.1:3100）
REVIEW_DB_PATH=D:/path/to/review.db npm run start:selfhost
```

- 环境变量：`REVIEW_DB_PATH` 必填（SQLite 文件路径，父目录自动创建，不会删除或清空已有库）；`HOST` 默认 `127.0.0.1`、`PORT` 默认 `3100` 可覆盖；`MATH_VAULT_DIR` 默认 `C:/Users/HUAWEI/Vault/猥琐凡人的仓库`，供 `data:build`/`data:verify` 读取原档案。
- 首次启动幂等创建 `review_progress` 表与 `review_progress_due_idx` 索引，不做破坏性迁移，重复启动不丢数据。
- 原档案（Vault 错题原题）保持只读，自建模式不写 Vault。

### 网页登录（可选，替代 Basic Auth）

用现有用户名和密码登录，登录后使用安全会话 Cookie（解决内置浏览器 Basic Auth 的 `ERR_TOO_MANY_RETRIES`）。先用配置脚本生成 `auth.env`（密码只从 stdin 读取、不回显，文件 0600、原子写、不含明文密码，内含 `SELFHOST_FORM_AUTH=1` 自动启用网页登录）；也可用环境变量 `SELFHOST_FORM_AUTH=1` 显式覆盖：

```bash
# 生成 <REVIEW_DB_PATH 同目录>/auth.env（或 SELFHOST_AUTH_ENV_FILE 指定路径）
REVIEW_DB_PATH=D:/path/to/review.db node scripts/configure-selfhost-auth.mjs
# 交互：输入用户名、密码；或管道两行（用户名\n密码）： printf 'user\npass\n' | ...

# 启动（自动从 REVIEW_DB_PATH 同目录 auth.env 或 SELFHOST_AUTH_ENV_FILE 加载；
# auth.env 已含 SELFHOST_FORM_AUTH=1，无需再手动设置）
REVIEW_DB_PATH=D:/path/to/review.db npm run start:selfhost
```

- 应用只提供窄认证端点：`/api/selfhost-auth/login`（登录页与表单）、`/api/selfhost-auth/logout`（清 Cookie）、`/api/selfhost-auth/check`（会话校验）。未设置 `SELFHOST_FORM_AUTH=1` 时这些端点一律返回 404，Sites 行为不变。
- 环境值：`SELFHOST_AUTH_USERNAME`、`SELFHOST_AUTH_PASSWORD_HASH`（PBKDF2-SHA256，格式 `pbkdf2-sha256$迭代次数$盐$摘要`）、`SELFHOST_SESSION_SECRET`（HMAC-SHA256 签名）。任一缺失 fail closed（启动拒绝或请求 500）。已有环境变量优先于 `auth.env`。
- 会话 Cookie：`__Host-kaoyan_session`，HttpOnly、Secure、SameSite=Lax、Path=/，默认 30 天，仅 HTTPS 下有效。

认证仍由外层 Caddy 全局执行：`/login`、`/logout` 直接反代到应用的窄端点；其余请求先 `forward_auth` 调 `/api/selfhost-auth/check`，校验成功后 Caddy 才反代并注入固定 `oai-authenticated-user-email` 头。Caddy 示例（`example.com` 换成真实域名，`selfhost@local` 换成固定邮箱）：

```caddyfile
example.com {
    encode zstd gzip

    handle /login* {
        rewrite * /api/selfhost-auth{path}
        reverse_proxy 127.0.0.1:3100
    }

    handle /logout* {
        rewrite * /api/selfhost-auth{path}
        reverse_proxy 127.0.0.1:3100
    }

    handle {
        forward_auth 127.0.0.1:3100 {
            uri /api/selfhost-auth/check
        }
        reverse_proxy 127.0.0.1:3100 {
            header_up oai-authenticated-user-email "selfhost@local"
        }
    }
}
```

- 信任边界：自建服务必须只绑定回环地址（loopback），由外层 Caddy 负责 TLS 终止与 forward_auth；不要直接把该服务暴露到网络，也不要在服务层实现完整认证。Caddy `forward_auth` 原生发送 `X-Forwarded-Uri`，`check` 端点优先用它跳回原页面（兼容 `X-Original-URI`，都缺失时回退到首页）。

## 校验

```bash
npm run lint
npm run build
```

## Canonical repository

`LPolaris-1/kaoyan-math-review` 的 `migration/selfhost-canonical` 分支正在重建并验证为 Aliyun self-host 的 canonical source candidate。当前尚未 merge 到 `main`，也未 commit/push；`main` 仍保留旧 Sites 的历史提交。完成 canonical cutover 后，`main` 才成为未来开发和部署的唯一源码来源。

生产边界明确分离：

- GitHub repository：源码、测试、迁移文件与文档
- Aliyun release：由源码构建出的部署产物
- `/opt/kaoyan-math-review/shared/review.db`：生产数据，不进入 Git

题目内容的 Source of Truth 是 `MATH_VAULT_DIR` 指向的错题原档案 Markdown。`public/data/history.json` 只能由 `scripts/build-review.mjs`（或正式数据生成器）生成，禁止手工修改；它是版本化的构建输入/静态数据。当前 canonical source 生成结果为 164 道题、30 天；生产 release `20260826-122638` 仍是 161 道题、29 天的线上行为基线。

### Canonical Cutover

在 `migration/selfhost-canonical` 合并 `main` 之前，生产 release `20260826-122638` 继续作为线上基线。合并后，GitHub `main` 成为未来所有开发和部署的唯一源码来源；不得再从 production bundle 或旧 `coding/错题复盘站` 目录反向开发或部署，也不得在服务器直接编辑业务源码。

长期架构、数据库、运维和部署说明见 [`docs/`](docs/)，阶段 1–3 的行为对照见 [`docs/REBUILD_PARITY_REPORT.md`](docs/REBUILD_PARITY_REPORT.md)。

### Self-host provenance

`npm run build:selfhost` 成功后会在 `dist/RELEASE.json` 写入 `git_commit`、`branch`、`built_at` 和 `mode`。该文件是可重新生成的部署元数据，不是手工编辑的版本源；`dist/` 本身不作为源码真源提交。
