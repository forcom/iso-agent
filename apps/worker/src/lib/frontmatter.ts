export function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: text };
  const block = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\n/, "");
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    meta[m[1]] = v;
  }
  return { meta, body };
}

export function formIdFromRecordId(recordId: string): string | null {
  // AIDU-AIP-06-01-F01-2026-001 -> AIDU-AIP-06-01-F01
  const m = recordId.match(/^(AIDU-[A-Z]+-\d{2}(?:-\d{2})?-F\d{2})-\d{4}-\d+$/i);
  return m ? m[1] : null;
}

export function procedureIdFromFormId(formId: string): string | null {
  // AIDU-AIP-06-01-F01 -> AIDU-AIP-06-01
  const m = formId.match(/^(AIDU-[A-Z]+-\d{2}(?:-\d{2})?)-F\d{2}$/i);
  return m ? m[1] : null;
}
