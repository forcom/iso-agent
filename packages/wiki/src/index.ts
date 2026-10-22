export interface WikiClaim {
  heading: string;
  text: string;
  quote?: string;
  fact_ids?: string[];
}

export interface WikiPage {
  id: string;
  title: string;
  status: "draft" | "approved";
  claims: WikiClaim[];
  links?: string[];
  source_document_ids?: string[];
}

export function pageToMarkdown(page: WikiPage): string {
  const lines = [
    `---`,
    `wiki_id: "${page.id}"`,
    `title: "${page.title}"`,
    `status: ${page.status}`,
    `---`,
    ``,
    `# ${page.title}`,
    ``,
  ];
  for (const c of page.claims) {
    lines.push(`## ${c.heading}`, ``, c.text, ``);
    if (c.quote) {
      lines.push(`> ${c.quote}`, ``);
    }
    if (c.fact_ids?.length) {
      lines.push(`Facts: ${c.fact_ids.join(", ")}`, ``);
    }
  }
  return lines.join("\n");
}
