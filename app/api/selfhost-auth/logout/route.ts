import { clearSessionCookieHeader, isFormAuthEnabled } from "../../../../lib/selfhost-auth.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleLogout();
}

export async function POST() {
  return handleLogout();
}

function handleLogout() {
  if (!isFormAuthEnabled()) return new Response("Not Found", { status: 404 });
  return new Response(null, {
    status: 303,
    headers: {
      location: "/login",
      "set-cookie": clearSessionCookieHeader(),
      "cache-control": "no-store",
    },
  });
}