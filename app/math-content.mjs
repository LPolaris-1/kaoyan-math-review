const mathSegmentPattern = /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])*\$/g;

export function normalizeMathDelimiters(value) {
  const normalized = value
    .replace(/(?<!\\)\\\[/g, () => "$$")
    .replace(/(?<!\\)\\\]/g, () => "$$")
    .replace(/(?<!\\)\\\(/g, () => "$")
    .replace(/(?<!\\)\\\)/g, () => "$");

  return normalized
    .split(/(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])*\$)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment
        .replace(/\(([A-Z][A-Za-z0-9]*)\^T\)/g, (_, base) => `$(${base}^{T})$`)
        .replace(/\b([A-Z][A-Za-z0-9]*)\^T\b/g, (_, base) => `$${base}^{T}$`);
    })
    .join("");
}

export function collectMathSegments(value) {
  const normalized = normalizeMathDelimiters(value);
  const segments = [...normalized.matchAll(mathSegmentPattern)].map((match) => {
    const raw = match[0];
    const displayMode = raw.startsWith("$$");
    return {
      displayMode,
      source: displayMode ? raw.slice(2, -2) : raw.slice(1, -1),
    };
  });

  return {
    normalized,
    segments,
    textOutsideMath: normalized.replace(mathSegmentPattern, ""),
  };
}
