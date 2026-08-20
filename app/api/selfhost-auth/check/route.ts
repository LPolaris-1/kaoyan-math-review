import {
  getAuthConfig,
  isFormAuthEnabled,
  safeReturnTo,
  sessionTokenFromHeaders,
  verifySessionToken,
} from "../../../../lib/selfhost-auth.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleCheck(request);
}

export async function POST(request: Request) {
  return handleCheck(request);
}

async function handleCheck(request: Request) {
  if (!isFormAuthEnabled()) return new Response("Not Found", { status: 404 });

  let config;
  try {
    config = getAuthConfig();
  } catch {
    return new Response("认证配置不完整，请联系管理员。", { status: 500, headers: { "cache-control": "no-store" } });
  }

  const token = sessionTokenFromHeaders(request.headers);
  const session = token ? await verifySessionToken(token, config.sessionSecret) : null;
  if (session && session.username === config.username) return new Response(null, { status: 204 });

  const accept = request.headers.get("accept") ?? "";
  const isBrowserNavigation =
    accept.includes("text/html") || request.headers.get("sec-fetch-mode") === "navigate";
  if (isBrowserNavigation) {
    // Caddy's forward_auth rewrites the URI; it sends the original path in
    // X-Forwarded-Uri natively (X-Original-URI is kept for older configs).
    // Fall back to the request path otherwise.
    const originalUri =
      request.headers.get("x-forwarded-uri") ??
      request.headers.get("x-original-uri") ??
      `${new URL(request.url).pathname}${new URL(request.url).search}`;
    const returnTo = safeReturnTo(originalUri);
    const location = returnTo ? `/login?return_to=${encodeURIComponent(returnTo)}` : "/login";
    return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
  }

  return Response.json({ error: "未登录或会话已过期。" }, { status: 401, headers: { "cache-control": "no-store" } });
}