import {
  getAuthConfig,
  isFormAuthEnabled,
  safeReturnTo,
  sessionCookieHeader,
  sessionExpiry,
  signSessionToken,
  verifyPassword,
} from "../../../../lib/selfhost-auth.mjs";

export const dynamic = "force-dynamic";

function loginPageHtml({ error = "", username = "", returnTo = "/" }: { error?: string; username?: string; returnTo?: string } = {}) {
  const escaped = (value: string) =>
    value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · 考研数学错题复盘站</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #111827; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .card { width: 100%; max-width: 360px; margin: 24px; padding: 28px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .sub { margin: 0 0 20px; font-size: 13px; color: #6b7280; }
  label { display: block; margin: 12px 0 4px; font-size: 13px; color: #374151; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
  button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 8px; background: #2563eb; color: #ffffff; font-size: 15px; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .error { margin-top: 16px; padding: 10px 12px; border-radius: 8px; background: #fee2e2; color: #991b1b; font-size: 13px; }
</style>
</head>
<body>
  <main class="card">
    <h1>登录错题复盘站</h1>
    <p class="sub">请输入账号密码继续访问</p>
    <form method="post" action="/login">
      <input type="hidden" name="return_to" value="${escaped(returnTo)}">
      <label for="username">用户名</label>
      <input id="username" name="username" autocomplete="username" required autofocus value="${escaped(username)}">
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">登录</button>
      ${error ? `<p class="error">${escaped(error)}</p>` : ""}
    </form>
  </main>
</body>
</html>`;
}

export async function GET(request: Request) {
  if (!isFormAuthEnabled()) return new Response("Not Found", { status: 404 });
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to")) ?? "/";
  return htmlResponse(loginPageHtml({ returnTo }));
}

export async function POST(request: Request) {
  if (!isFormAuthEnabled()) return new Response("Not Found", { status: 404 });

  let config;
  try {
    config = getAuthConfig();
  } catch {
    return new Response("认证配置不完整，请联系管理员。", { status: 500, headers: { "cache-control": "no-store" } });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return htmlResponse(loginPageHtml({ error: "请求无效。" }));
  }
  const username = String(form.get("username") ?? "").slice(0, 200);
  const password = String(form.get("password") ?? "");
  const returnTo = safeReturnTo(String(form.get("return_to") ?? "")) ?? "/";

  const passwordOk = await verifyPassword(password, config.passwordHash);
  if (username !== config.username || !passwordOk) {
    return htmlResponse(loginPageHtml({ error: "用户名或密码错误。", username, returnTo }));
  }

  const token = await signSessionToken(config.username, config.sessionSecret, sessionExpiry());
  return new Response(null, {
    status: 303,
    headers: {
      location: returnTo,
      "set-cookie": sessionCookieHeader(token),
      "cache-control": "no-store",
    },
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}