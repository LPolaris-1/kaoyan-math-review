# 考研数学 · 错题复盘站

本地复盘网站。它读取 Vault 中的考研数学错题原档案，按日期生成历史记录，网页支持日期切换、学科筛选、关键词搜索和逐题展开。

## 使用

```bash
npm run data:build
npm run dev
```

浏览器打开终端输出的本地地址即可。每天 22:00 的 Codex 定时任务会自动运行 `npm run data:build`。

## 数据约定

- 原始输入：`06-Resources/学习/考研/考研数学/错题本/原档案/`
- 生成数据：`public/data/history.json`
- 日期识别顺序：Frontmatter `created` → 正文日期 → 文件名日期
- 原档案只读，历史数据全量重建且不删除旧日期

## 校验

```bash
npm run lint
npm run build
```
