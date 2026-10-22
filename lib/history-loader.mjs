export const HISTORY_URL = "/data/history.json";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isHistory(value) {
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
      day.items.every((item) => isRecord(item) &&
        ["id", "title", "subject", "chapter", "topic", "content", "sourcePath"].every((key) => typeof item[key] === "string") &&
        isStringArray(item.methods) &&
        isStringArray(item.keyPoints) &&
        isStringArray(item.pitfalls) &&
        typeof item.isPastExam === "boolean"));
}

export async function loadHistory(fetcher = fetch, timeoutMs = 25_000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("错题历史加载超时，请重试。"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let response;
      try {
        response = await fetcher(HISTORY_URL, { signal: controller.signal });
      } catch {
        throw new Error("错题历史请求失败，请检查网络后重试。");
      }
      if (response.status === 401) throw new Error("登录状态已失效，请重新登录后重试。");
      if (!response.ok) throw new Error(`错题历史加载失败（HTTP ${response.status}），请重试。`);
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("错题历史响应无效或不完整，请重试。");
      }
      if (!isHistory(data)) throw new Error("错题历史数据结构无效，请重试。");
      return data;
    })()]);
  } finally {
    clearTimeout(timer);
  }
}
