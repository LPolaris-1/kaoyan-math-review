export const HISTORY_URL = "/data/history.json";
export const HISTORY_INDEX_URL = "/data/history-index.json";
export const HISTORY_DAYS_DIR = "/data/history-days";
export const HISTORY_TIMEOUT_MS = 60_000;
export const HISTORY_RETRY_DELAY_MS = 500;

const dayCache = new Map();

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIndexItem(item) {
  return isRecord(item) &&
    ["id", "title", "subject", "chapter", "topic", "sourcePath"].every((key) => typeof item[key] === "string") &&
    isStringArray(item.methods) &&
    isStringArray(item.keyPoints) &&
    isStringArray(item.pitfalls) &&
    typeof item.isPastExam === "boolean";
}

function isHistoryIndex(value) {
  return isRecord(value) &&
    typeof value.generatedAt === "string" &&
    Number.isFinite(value.totalNotes) &&
    Number.isFinite(value.totalDays) &&
    Array.isArray(value.days) &&
    value.days.every((day) => isRecord(day) &&
      typeof day.date === "string" &&
      Number.isFinite(day.count) &&
      isRecord(day.subjectCounts) &&
      isStringArray(day.topics) &&
      isStringArray(day.takeaways) &&
      typeof day.summary === "string" &&
      Array.isArray(day.items) &&
      day.items.every(isIndexItem));
}

function isHistoryDay(value, expectedDate) {
  if (!isRecord(value) || value.date !== expectedDate || !Array.isArray(value.items)) return false;
  const ids = new Set();
  return value.items.every((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.content !== "string") return false;
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
}

function historyDayUrl(date) {
  return `${HISTORY_DAYS_DIR}/${encodeURIComponent(date)}.json`;
}

function loadError(kind, message, options = {}) {
  const error = new Error(message, options.cause ? { cause: options.cause } : undefined);
  error.name = "HistoryLoadError";
  error.kind = kind;
  if (options.status !== undefined) error.status = options.status;
  return error;
}

function isRetryable(error) {
  return error?.kind === "network" ||
    error?.kind === "timeout" ||
    error?.kind === "server" ||
    error?.kind === "truncated-json";
}

function isTruncatedJsonError(error) {
  if (!(error instanceof SyntaxError)) return false;
  return /unexpected end|unterminated|unexpected eof|end of json input/i.test(error.message);
}

async function runAttempt(url, fetcher, timeoutMs, label) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const timeoutError = loadError("timeout", `${label}加载超时，请稍后重试。`);
  let work;

  try {
    work = (async () => {
      let response;
      try {
        response = await fetcher(url, { signal: controller.signal });
      } catch (error) {
        if (timedOut) throw timeoutError;
        throw loadError("network", `${label}请求失败，请检查网络后重试。`, { cause: error });
      }

      if (response.status === 401) {
        throw loadError("auth", "登录状态已失效，请重新登录后重试。", { status: 401 });
      }
      if (response.status === 403) {
        throw loadError("forbidden", "没有权限访问错题历史，请确认登录状态后重试。", { status: 403 });
      }
      if (!response.ok) {
        const kind = response.status >= 500 ? "server" : "http";
        throw loadError(kind, `${label}加载失败（HTTP ${response.status}），请稍后重试。`, { status: response.status });
      }

      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (timedOut) throw timeoutError;
        if (isTruncatedJsonError(error)) {
          throw loadError("truncated-json", `${label}响应不完整（可能被截断），请稍后重试。`, { cause: error });
        }
        if (error instanceof SyntaxError) {
          throw loadError("invalid-json", `${label}响应无效，请刷新后重试。`, { cause: error });
        }
        throw loadError("network", `${label}请求中断，请检查网络后重试。`, { cause: error });
      }
      return data;
    })();

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(timeoutError);
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadWithRetry(url, fetcher, timeoutMs, retryDelayMs, label, validate) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await runAttempt(url, fetcher, timeoutMs, label);
      validate(data);
      return data;
    } catch (error) {
      if (attempt === 0 && isRetryable(error)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw error;
    }
  }
  throw loadError("unknown", `${label}加载失败，请稍后重试。`);
}

export function loadHistory(
  fetcher = fetch,
  timeoutMs = HISTORY_TIMEOUT_MS,
  retryDelayMs = HISTORY_RETRY_DELAY_MS,
) {
  return loadWithRetry(HISTORY_INDEX_URL, fetcher, timeoutMs, retryDelayMs, "错题历史", (data) => {
    if (!isHistoryIndex(data)) throw loadError("invalid-schema", "错题历史数据结构无效，请刷新后重试。");
  });
}

export function loadHistoryDay(
  date,
  fetcher = fetch,
  timeoutMs = HISTORY_TIMEOUT_MS,
  retryDelayMs = HISTORY_RETRY_DELAY_MS,
) {
  const key = String(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return Promise.reject(loadError("invalid-date", "错题日期无效，请刷新后重试。"));
  }
  const cached = dayCache.get(key);
  if (cached) return cached;

  const promise = loadWithRetry(
    historyDayUrl(key),
    fetcher,
    timeoutMs,
    retryDelayMs,
    "当日错题详情",
    (data) => {
      if (!isHistoryDay(data, key)) {
        throw loadError("invalid-schema", "当日错题详情数据无效，请刷新后重试。");
      }
    },
  ).catch((error) => {
    if (dayCache.get(key) === promise) dayCache.delete(key);
    throw error;
  });
  dayCache.set(key, promise);
  return promise;
}
