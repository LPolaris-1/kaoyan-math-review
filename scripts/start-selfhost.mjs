#!/usr/bin/env node
// Start the self-hosted production server from dist/ using vinext's Node
// prod-server. Binds to loopback (127.0.0.1) by default; put Caddy in front to
// terminate TLS, run forward_auth against /api/selfhost-auth/check, and inject
// the oai-authenticated-user-email identity header only after a valid session.
// Never expose this server directly to a network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startProdServer } from "vinext/server/prod-server";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

if (!process.env.REVIEW_DB_PATH) {
  console.error(
    "[start:selfhost] REVIEW_DB_PATH is not set. Refusing to start without a SQLite database path.",
  );
  process.exit(1);
}

loadAuthEnv();

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3100", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[start:selfhost] Invalid PORT value: ${process.env.PORT ?? ""}`);
  process.exit(1);
}

await startProdServer({
  host,
  port,
  outDir: path.join(projectRoot, "dist"),
});

// Load the web-login auth file (SELFHOST_AUTH_USERNAME / _PASSWORD_HASH /
// SELFHOST_SESSION_SECRET). Existing environment variables always win; the
// file only fills in unset values. With SELFHOST_FORM_AUTH=1 a missing or
// incomplete configuration is a hard startup failure (fail closed).
function loadAuthEnv() {
  const file = resolveAuthEnvFile();
  if (file && fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }

  if (process.env.SELFHOST_FORM_AUTH === "1") {
    const required = [
      "SELFHOST_AUTH_USERNAME",
      "SELFHOST_AUTH_PASSWORD_HASH",
      "SELFHOST_SESSION_SECRET",
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      console.error(
        `[start:selfhost] SELFHOST_FORM_AUTH=1 but ${missing.join(", ")} is not set (auth env file: ${file ?? "none"}). Refusing to start without a complete auth configuration.`,
      );
      process.exit(1);
    }
  }
}

function resolveAuthEnvFile() {
  if (process.env.SELFHOST_AUTH_ENV_FILE) return process.env.SELFHOST_AUTH_ENV_FILE;
  return path.join(path.dirname(path.resolve(process.env.REVIEW_DB_PATH)), "auth.env");
}