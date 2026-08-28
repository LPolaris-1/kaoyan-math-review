#!/usr/bin/env node
// Start a self-host build against a temporary SQLite database and verify the
// public page/asset contract without touching production state.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? process.cwd());
const history = JSON.parse(fs.readFileSync(path.join(root, "public/data/history.json"), "utf8"));
const expectedNotes = uniqueHistoryItems(history);
const expectedDays = Array.isArray(history.days) ? history.days.length : 0;
if (expectedNotes === 0 || expectedDays === 0) throw new Error("canonical history data is empty");

const port = await freePort();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaoyan-selfhost-smoke-"));
const dbPath = path.join(tempDir, "review.db");
const child = spawn(process.execPath, ["scripts/start-selfhost.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    REVIEW_DB_PATH: dbPath,
    SELFHOST_FORM_AUTH: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  const base = `http://127.0.0.1:${port}`;
  await waitUntilReady(`${base}/`, child, () => output);
  const rootResponse = await fetch(`${base}/`);
  const reviewResponse = await fetch(`${base}/review`);
  const historyResponse = await fetch(`${base}/data/history.json`);
  assertStatus(rootResponse, "/");
  assertStatus(reviewResponse, "/review");
  assertStatus(historyResponse, "/data/history.json");

  const html = await reviewResponse.text();
  const assets = [...new Set(html.match(/\/assets\/[^"'\s]+\.(?:js|css)/g) ?? [])];
  const jsAsset = assets.find((asset) => asset.endsWith(".js"));
  const cssAsset = assets.find((asset) => asset.endsWith(".css"));
  if (!jsAsset) throw new Error("/review did not expose a JavaScript asset");
  if (!cssAsset) throw new Error("/review did not expose a CSS asset");
  const jsResponse = await fetch(`${base}${jsAsset}`);
  const cssResponse = await fetch(`${base}${cssAsset}`);
  assertAsset(jsResponse, jsAsset, "javascript");
  assertAsset(cssResponse, cssAsset, "text/css");

  const remoteHistory = await historyResponse.json();
  const remoteNotes = uniqueHistoryItems(remoteHistory);
  const remoteDays = Array.isArray(remoteHistory.days) ? remoteHistory.days.length : 0;
  if (remoteNotes !== expectedNotes) throw new Error(`history item count mismatch: ${remoteNotes} != ${expectedNotes}`);
  if (remoteDays !== expectedDays) throw new Error(`history day count mismatch: ${remoteDays} != ${expectedDays}`);
  if (remoteHistory.totalNotes !== history.totalNotes) throw new Error("history totalNotes mismatch");
  console.log(`selfhost smoke passed: / 200, /review 200, history 200, JS 200, CSS 200, ${remoteNotes} items/${remoteDays} days`);
} finally {
  await stopChild(child);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function uniqueHistoryItems(data) {
  const items = Array.isArray(data?.days) ? data.days.flatMap((day) => Array.isArray(day.items) ? day.items : []) : [];
  return new Set(items.map((item) => item.id).filter(Boolean)).size;
}

function assertStatus(response, route) {
  if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
}

function assertAsset(response, asset, expectedType) {
  assertStatus(response, asset);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(expectedType)) throw new Error(`${asset} content-type is ${contentType}`);
}

async function waitUntilReady(url, process, getOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`selfhost exited before ready: ${getOutput()}`);
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // The server may still be binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`selfhost did not become ready: ${getOutput()}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function stopChild(childProcess) {
  if (childProcess.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    childProcess.once("exit", finish);
    childProcess.kill("SIGTERM");
    setTimeout(() => {
      if (finished) return;
      if (globalThis.process.platform === "win32") spawnSync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], { stdio: "ignore" });
      else childProcess.kill("SIGKILL");
      finish();
    }, 2000).unref();
  });
}
