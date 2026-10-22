import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) =>
  c.json({ ok: true, app: c.env.APP_NAME ?? "iso-agent" }),
);

export default app;
