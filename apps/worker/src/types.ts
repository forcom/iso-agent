import type { WikiClaim } from "../../../packages/wiki/src/index";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
  ENGINE_URL?: string;
  APP_NAME?: string;
}

export type Permission =
  | "doc.read"
  | "record.read"
  | "record.write"
  | "record.scan"
  | "fact.approve"
  | "seed.import"
  | "query.ask"
  | "impact.draft"
  | "wiki.read"
  | "wiki.write";

export interface SeedPayload {
  meta: {
    ontology_revision: string;
    generated_by?: string;
    generated_at?: string;
  };
  entities?: {
    id: string;
    type: string;
    name: string;
    aliases?: string[];
    source_ref?: string;
  }[];
  facts?: {
    id?: string;
    subject: string;
    predicate: string;
    object: string;
    quote?: string;
    source_document_id?: string;
    revision?: string;
    status?: "draft" | "approved";
  }[];
  wiki_pages?: {
    id?: string;
    title: string;
    status?: "draft" | "approved";
    claims: WikiClaim[];
    links?: string[];
  }[];
}
