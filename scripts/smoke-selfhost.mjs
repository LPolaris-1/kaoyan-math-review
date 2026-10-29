#!/usr/bin/env node
// Start a self-host build against a temporary SQLite database and verify the
// public page/asset contract without touching production state.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) await runSmoke();

async function runSmoke() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const { history, index } = loadCanonicalHistory(root);
  const expectedNotes = uniqueHistoryItems(history);
  const expectedDays = Array.isArray(history.days) ? history.days.length : 0;
  if (expectedNotes === 0 || expectedDays === 0) throw new Error("canonical history data is empty");
  if (uniqueHistoryItems(index) !== expectedNotes || index.totalDays !== expectedDays) {
    throw new Error("history-index.json does not match canonical history.json");
  }
  const expectedDay = index.days?.[0];
  if (!expectedDay?.date) throw new Error("history-index.json contains no days");

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
    const indexResponse = await fetch(`${base}/data/history-index.json`);
    const dayPath = `/data/history-days/${expectedDay.date}.json`;
    const dayResponse = await fetch(`${base}${dayPath}`);
    assertStatus(rootResponse, "/");
    assertStatus(reviewResponse, "/review");
    assertStatus(historyResponse, "/data/history.json");
    assertStatus(indexResponse, "/data/history-index.json");
    assertStatus(dayResponse, dayPath);
    assertNoCache(historyResponse.headers, "/data/history.json");
    assertNoCache(indexResponse.headers, "/data/history-index.json");
    assertNoCache(dayResponse.headers, dayPath);

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
    const remoteIndex = await indexResponse.json();
    const remoteDay = await dayResponse.json();
    const remoteNotes = uniqueHistoryItems(remoteHistory);
    const remoteDays = Array.isArray(remoteHistory.days) ? remoteHistory.days.length : 0;
    if (remoteNotes !== expectedNotes) throw new Error(`history item count mismatch: ${remoteNotes} != ${expectedNotes}`);
    if (remoteDays !== expectedDays) throw new Error(`history day count mismatch: ${remoteDays} != ${expectedDays}`);
    if (remoteHistory.totalNotes !== history.totalNotes) throw new Error("history totalNotes mismatch");
    if (remoteIndex.totalNotes !== index.totalNotes || uniqueHistoryItems(remoteIndex) !== expectedNotes) {
      throw new Error("history-index.json item count mismatch");
    }
    assertDayPayload(remoteDay, history.days.find((day) => day.date === expectedDay.date));

    const identityIndex = await requestRaw(base, "/data/history-index.json", { "accept-encoding": "identity" });
    assertRawStatus(identityIndex, "/data/history-index.json");
    assertNoCache(identityIndex.headers, "/data/history-index.json");
    if (identityIndex.headers["content-encoding"]) throw new Error("identity index response was compressed");
    const etag = identityIndex.headers.etag;
    if (!etag) throw new Error("history-index.json response has no ETag");

    const brotliIndex = await requestRaw(base, "/data/history-index.json", { "accept-encoding": "br" });
    const gzipIndex = await requestRaw(base, "/data/history-index.json", { "accept-encoding": "gzip" });
    assertRawStatus(brotliIndex, "/data/history-index.json (br)");
    assertRawStatus(gzipIndex, "/data/history-index.json (gzip)");
    assertEncoding(brotliIndex, "br");
    assertEncoding(gzipIndex, "gzip");
    if (brotliIndex.body.length >= identityIndex.body.length) throw new Error("Brotli variant is not smaller than identity");
    if (gzipIndex.body.length >= identityIndex.body.length) throw new Error("gzip variant is not smaller than identity");

    const notModified = await requestRaw(base, "/data/history-index.json", {
      "accept-encoding": "identity",
      "if-none-match": etag,
    });
    if (notModified.status !== 304) throw new Error(`conditional history-index request returned HTTP ${notModified.status}`);
    assertNoCache(notModified.headers, "/data/history-index.json 304");

    console.log(
      `selfhost smoke passed: / 200, /review 200, history/index/day 200, ` +
      `br/gzip negotiated, ETag 304, ${remoteNotes} items/${remoteDays} days`,
    );
  } finally {
    await stopChild(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Source trees keep the canonical data under public/data. Immutable release
// artifacts ship only dist/client/data, so accept both without requiring
// public/ in a release.
export function resolveHistoryDataDir(root) {
  const candidates = [
    path.join("public", "data"),
    path.join("dist", "client", "data"),
  ];
  for (const relative of candidates) {
    const directory = path.join(root, relative);
    if (
      fs.existsSync(path.join(directory, "history.json")) &&
      fs.existsSync(path.join(directory, "history-index.json"))
    ) {
      return directory;
    }
  }
  throw new Error(
    `canonical history data not found; checked ${candidates.join(", ")} under ${root}`,
  );
}

export function loadCanonicalHistory(root) {
  const dataDir = resolveHistoryDataDir(root);
  const history = JSON.parse(fs.readFileSync(path.join(dataDir, "history.json"), "utf8"));
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "history-index.json"), "utf8"));
  return { dataDir, history, index };
}

function uniqueHistoryItems(data) {
  const items = Array.isArray(data?.days) ? data.days.flatMap((day) => Array.isArray(day.items) ? day.items : []) : [];
  return new Set(items.map((item) => item.id).filter(Boolean)).size;
}

function assertDayPayload(day, canonicalDay) {
  if (!canonicalDay) throw new Error("canonical day is missing");
  if (day?.date !== canonicalDay.date || !Array.isArray(day.items)) throw new Error("history day payload is invalid");
  if (day.items.length !== canonicalDay.items.length) throw new Error("history day item count mismatch");
  const expected = new Map(canonicalDay.items.map((item) => [item.id, item.content]));
  const seen = new Set();
  for (const item of day.items) {
    if (typeof item?.id !== "string" || typeof item.content !== "string") throw new Error("history day item is invalid");
    if (seen.has(item.id)) throw new Error(`duplicate history day item: ${item.id}`);
    seen.add(item.id);
    if (item.content !== expected.get(item.id)) throw new Error(`history day content mismatch: ${item.id}`);
  }
}

export function assertNoCache(headers, route) {
  const cacheControl = (
    typeof headers.get === "function" ? headers.get("cache-control") : headers["cache-control"]
  )?.toLowerCase() ?? "";
  if (!cacheControl.includes("no-cache") || !cacheControl.includes("must-revalidate")) {
    throw new Error(`${route} cache policy is ${cacheControl || "missing"}; expected no-cache`);
  }
}

function assertStatus(response, route) {
  if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
}

function assertRawStatus(response, route) {
  if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
}

function assertEncoding(response, expected) {
  const encoding = response.headers["content-encoding"];
  if (encoding !== expected) throw new Error(`history-index.json content-encoding is ${encoding || "missing"}; expected ${expected}`);
  const vary = response.headers.vary ?? "";
  if (!vary.toLowerCase().includes("accept-encoding")) throw new Error("compressed history response has no Vary: Accept-Encoding");
  if (!response.headers.etag) throw new Error("compressed history response has no ETag");
  assertNoCache(new Headers(response.headers), "compressed history-index.json");
}

function assertAsset(response, asset, expectedType) {
  assertStatus(response, asset);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(expectedType)) throw new Error(`${asset} content-type is ${contentType}`);
}

function requestRaw(base, pathname, headers) {
  return new Promise((resolve, reject) => {
    const request = http.get(new URL(pathname, base), { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error(`raw request timed out: ${pathname}`)));
    request.on("error", reject);
  });
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
