export interface WikiClaim {
  heading: string;
  text: string;
  quote?: string;
  fact_ids?: string[];
  source_document_id?: string;
  source_ref?: string;
  source_sha?: string;
}

export interface WikiPage {
  id: string;
  title: string;
  status: "draft" | "approved";
  claims: WikiClaim[];
  links?: string[];
  source_document_ids?: string[];
}

/** Older seeds did not require a heading or typed claim properties. */
export function normalizeWikiClaims(value: unknown): WikiClaim[] {
  if (!Array.isArray(value)) return [];
  return value.filter(c => c && typeof c === "object").map(c => ({
    heading: typeof c.heading === "string" && c.heading ? c.heading : "Claim",
    text: typeof c.text === "string" ? c.text : "",
    quote: typeof c.quote === "string" ? c.quote : undefined,
    fact_ids: Array.isArray(c.fact_ids) ? c.fact_ids.filter((id: unknown) => typeof id === "string") : [],
    source_document_id: typeof c.source_document_id === "string" ? c.source_document_id : undefined,
    source_ref: typeof c.source_ref === "string" ? c.source_ref : undefined,
    source_sha: typeof c.source_sha === "string" ? c.source_sha : undefined,
  }));
}

export function pageToMarkdown(page: WikiPage): string {
  const lines = [
    `---`,
    `wiki_id: "${page.id}"`,
    `title: ${JSON.stringify(page.title)}`,
    `status: ${page.status}`,
    `---`,
    ``,
    `# ${page.title}`,
    ``,
  ];
  for (const c of normalizeWikiClaims(page.claims)) {
    lines.push(`## ${c.heading}`, ``, c.text, ``);
    if (c.quote) {
      lines.push(...c.quote.split("\n").map((line) => `> ${line}`), ``);
    }
    if (c.source_ref) lines.push(`출처: [${c.source_document_id ?? c.source_ref}](/${c.source_ref})`, ``);
    if (c.source_sha) lines.push(`Source SHA-256: ${c.source_sha}`, ``);
    if (c.fact_ids?.length) {
      lines.push(`Facts: ${c.fact_ids.join(", ")}`, ``);
    }
  }
  if (page.links?.length) lines.push("## 관련 페이지·개체", "", ...page.links.map((link) => `- [[${link}]]`), "");
  return lines.join("\n");
}
