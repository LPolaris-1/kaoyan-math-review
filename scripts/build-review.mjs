import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vaultDir = "C:/Users/HUAWEI/Vault/猥琐凡人的仓库";
const sourceDir = path.join(vaultDir, "06-Resources", "学习", "考研", "考研数学", "错题本", "原档案");
const outputDir = path.join(projectDir, "public", "data");
const outputFile = path.join(outputDir, "history.json");

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  });
}

function clean(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseList(value) {
  if (!value) return [];
  const match = value.match(/^\[(.*)\]$/);
  if (match) return match[1].split(",").map((item) => clean(item.replace(/^['"]|['"]$/g, ""))).filter(Boolean);
  return value.split(/\n/).map((item) => clean(item.replace(/^[-*]\s*/, ""))).filter(Boolean);
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { fields: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { fields: {}, body: text };
  const raw = text.slice(3, end).replace(/^\r?\n/, "");
  const fields = {};
  let currentList = null;
  for (const line of raw.split(/\r?\n/)) {
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentList) {
      fields[currentList].push(clean(listItem[1]));
      continue;
    }
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    if (!field) continue;
    const [, key, value] = field;
    if (!value) {
      fields[key] = [];
      currentList = key;
    } else {
      fields[key] = value.replace(/^['"]|['"]$/g, "").trim();
      currentList = null;
    }
  }
  return { fields, body: text.slice(end + 4).trim() };
}

function localDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFrom(fields, body, filePath, historicalDate) {
  const fileModifiedDate = localDate(fs.statSync(filePath).mtime);
  const today = localDate(new Date());
  if (fileModifiedDate === today) return fileModifiedDate;
  if (historicalDate) return historicalDate;
  const frontmatterDate = String(fields.created || fields.date || "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const bodyDate = body.match(/(?:\*\*)?(?:日期|创建日期|记录日期)(?:\*\*)?\s*[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const fileDate = path.basename(filePath).match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return frontmatterDate || bodyDate || fileDate || fileModifiedDate;
}

function section(body, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = body.match(new RegExp(`^#{1,6}\\s*(?:${escaped})\\s*$([\\s\\S]*?)(?=^#{1,6}\\s|$)`, "im"));
  return match ? clean(match[1]) : "";
}

function bullets(body, names) {
  return section(body, names).split(/\s+-\s+|\s+\*\s+/).map(clean).filter(Boolean).slice(0, 5);
}

function parseNote(filePath, historicalDates) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { fields, body } = parseFrontmatter(raw);
  const relativePath = path.relative(vaultDir, filePath).split(path.sep).join("/");
  const date = dateFrom(fields, body, filePath, historicalDates.get(relativePath));
  if (!date) return null;
  const title = clean(body.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, ".md"));
  const subject = clean(String(fields.subject || (filePath.includes("\\线代\\") ? "线代" : "高数")));
  const methods = Array.isArray(fields.methods) ? fields.methods.map(clean).filter(Boolean) : parseList(fields.methods);
  const inlineTopic = body.match(/(?:\*\*)?(?:知识点|主题)(?:\*\*)?\s*[：:]\s*([^\n]+)/)?.[1] || "";
  const topic = clean(String(fields.topic || fields.source_section || inlineTopic).split(",")[0]);
  const question = section(body, ["题目", "问题"]);
  const keyPoints = bullets(body, ["考点", "核心公式", "技巧小结"]);
  const pitfalls = bullets(body, ["易错点", "考研防坑", "易错点 & 反思"]);
  const answer = section(body, ["答案", "最终答案", "核心结论"]);
  return {
    id: relativePath,
    date,
    title,
    subject,
    chapter: clean(String(fields.source_chapter || "")),
    topic,
    methods,
    question,
    keyPoints,
    pitfalls,
    answer,
    content: body,
    tags: Array.isArray(fields.tags) ? fields.tags.map(clean).filter(Boolean) : parseList(fields.tags),
    sourcePath: relativePath,
  };
}

function buildHistory(historicalDates) {
  const notes = walk(sourceDir).filter((filePath) => filePath.toLowerCase().endsWith(".md"));
  const parsed = notes.map((filePath) => parseNote(filePath, historicalDates)).filter(Boolean);
  const byDate = new Map();
  for (const note of parsed) {
    const date = note.date;
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(note);
  }
  const days = [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => {
    const subjectCounts = items.reduce((counts, item) => {
      counts[item.subject] = (counts[item.subject] || 0) + 1;
      return counts;
    }, {});
    const topics = [...new Set(items.map((item) => item.topic).filter(Boolean))].slice(0, 6);
    const takeaways = [...new Set(items.flatMap((item) => [...item.keyPoints, ...item.pitfalls]))].slice(0, 6);
    return {
      date,
      count: items.length,
      subjectCounts,
      topics,
      takeaways,
      summary: `${items.length} 道错题 · ${Object.entries(subjectCounts).map(([subject, count]) => `${subject} ${count} 道`).join("、")}`,
      items: items.sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    source: "06-Resources/学习/考研/考研数学/错题本/原档案",
    totalNotes: parsed.length,
    totalDays: days.length,
    days,
  };
}

function readExistingHistory() {
  if (!fs.existsSync(outputFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(outputFile, "utf8"));
  } catch {
    return null;
  }
}

const existing = readExistingHistory();
const historicalDates = new Map(
  (existing?.days || []).flatMap((day) => (day.items || []).map((item) => [item.id, item.date])),
);
const nextHistory = buildHistory(historicalDates);
const comparable = (history) => {
  if (!history) return null;
  const rest = { ...history };
  delete rest.generatedAt;
  return rest;
};

if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(nextHistory))) {
  console.log(`Unchanged ${outputFile}`);
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const next = JSON.stringify({ ...nextHistory, generatedAt: new Date().toISOString() }, null, 2);
const tempFile = `${outputFile}.tmp`;
fs.writeFileSync(tempFile, `${next}\n`, "utf8");
fs.renameSync(tempFile, outputFile);
console.log(`Generated ${outputFile}`);
