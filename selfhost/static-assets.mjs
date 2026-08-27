// Normalize vinext's cached static-file URL keys on Windows. Node's
// path.relative() returns backslashes there, while browser URLs always use
// forward slashes. Linux and macOS caches are already URL-compatible.
export function normalizeStaticCacheKeys(cache, platform = process.platform) {
  if (platform !== "win32" || !cache || !(cache.entries instanceof Map)) return cache;

  const normalizedEntries = new Map();
  for (const [pathname, entry] of cache.entries) {
    normalizedEntries.set(pathname.replaceAll("\\", "/"), entry);
  }
  cache.entries = normalizedEntries;
  return cache;
}
