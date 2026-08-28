# 考研数学 · 错题复盘站

考研数学错题复盘站。它读取 Vault 中的错题原档案，生成可追溯的历史数据，并通过艾宾浩斯调度帮助你安排、完成和回顾每一道错题。

## 功能

- **历史错题浏览**：按日期浏览生成的历史记录，按学科筛选、关键词搜索，并展开题目、方法和复盘内容。
- **艾宾浩斯复习**：每道题按 Day 1、Day 2、Day 4、Day 7、Day 15、Day 30 六个节点安排；首次答对从 Day 1 开始，做错会重启记忆链，模糊会安排下一次复习。
- **今日复习**：只展示今天到期的题目，按考频、掌握度和复习节点排序；提交“做对 / 有点模糊 / 做错了”后才记录复习事件。
- **全部进度**：查看每道题的当前阶段、掌握度、最近结果、下一次复习日期和完整时间轴；支持按状态、掌握度、关键词筛选和按下一次复习/最近复习/掌握度排序。
- **复习总览**：提供 KPI、未来 7/30/60 天全局时间轴、逾期题列表和四象限（核心盲区、提分潜力、巩固区、安全区）筛选。
- **手动立即复习**：从总览或全部进度进入正式复习流程，不重置 Day 1、不直接推进节点；只有提交结果后才产生事件。
- **掌握状态**：标记“已掌握”后退出自动复习队列，但仍保留在全部进度和历史记录中。

## 使用

```bash
npm run data:build
npm run dev
```

浏览器打开终端输出的本地地址即可。首次使用建议先运行 `npm run data:build`，之后每天 22:00 的自动任务会刷新历史数据。进入站点后，从“今日复习”开始；需要查看全量状态时打开“全部进度”或“复习总览”。

### 日常复习流程

1. 在“全部进度”中为尚未开始的题目设置 Day 1（可设为今天或一个不晚于今天的历史日期）。
2. 在“今日复习”中打开题目，完成复盘后选择“做对”“有点模糊”或“做错了”。
3. 在“复习总览”查看未来时间轴、逾期题和四象限；在“全部进度”检查单题时间轴与下一次复习日期。
4. 已经稳定掌握的题目可标记“已掌握”，它不会自动出现在今日队列中。

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

`LPolaris-1/kaoyan-math-review` 的 `main` 是 Aliyun self-host 的 canonical source。`migration/selfhost-canonical` 和阶段性 feature 分支保留为可追溯历史；后续开发和部署均应从 `main` 派生并构建。

生产边界明确分离：

- GitHub repository：源码、测试、迁移文件与文档
- Aliyun release：由源码构建出的部署产物
- `/opt/kaoyan-math-review/shared/review.db`：生产数据，不进入 Git

题目内容的 Source of Truth 是 `MATH_VAULT_DIR` 指向的错题原档案 Markdown。`public/data/history.json` 只能由 `scripts/build-review.mjs`（或正式数据生成器）生成，禁止手工修改；它是版本化的构建输入/静态数据。当前 canonical source 生成结果为 164 道题、30 天；生产 release `20260826-122638` 仍是 161 道题、29 天的线上行为基线。

### Canonical Cutover

`main` 已是 canonical self-host 源码分支，未来开发和部署均从 GitHub `main` 构建。不得再从 production bundle 或旧 `coding/错题复盘站` 目录反向开发或部署，也不得在服务器直接编辑业务源码。

长期架构、数据库、运维和部署说明见 [`docs/`](docs/)，阶段 1–3 的行为对照见 [`docs/REBUILD_PARITY_REPORT.md`](docs/REBUILD_PARITY_REPORT.md)。

### Self-host provenance

`npm run build:selfhost` 成功后会在 `dist/RELEASE.json` 写入 `git_commit`、`branch`、`built_at` 和 `mode`。该文件是可重新生成的部署元数据，不是手工编辑的版本源；`dist/` 本身不作为源码真源提交。
