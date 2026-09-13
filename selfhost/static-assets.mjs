// Normalize vinext's cached static-file URL keys on Windows. Node's
// path.relative() returns backslashes there, while browser URLs always use
// forward slashes. Also prevent stale browser data for the generated history.
export const HISTORY_PATH = "/data/history.json";
export const HISTORY_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate";

export function normalizeStaticCacheKeys(cache, platform = process.platform) {
  if (!cache || !(cache.entries instanceof Map)) return cache;

  const normalizeKeys = platform === "win32";
  const normalizedEntries = normalizeKeys ? new Map() : cache.entries;
  for (const [pathname, entry] of cache.entries) {
    const normalizedPath = normalizeKeys ? pathname.replaceAll("\\", "/") : pathname;
    if (normalizedPath === HISTORY_PATH) applyHistoryCachePolicy(entry);
    if (normalizeKeys) normalizedEntries.set(normalizedPath, entry);
  }
  if (normalizeKeys) cache.entries = normalizedEntries;
  return cache;
}

function applyHistoryCachePolicy(entry) {
  for (const variant of [entry.original, entry.br, entry.gz, entry.zst]) {
    if (variant?.headers) variant.headers["Cache-Control"] = HISTORY_CACHE_CONTROL;
  }
  if (entry.notModifiedHeaders) entry.notModifiedHeaders["Cache-Control"] = HISTORY_CACHE_CONTROL;
}
