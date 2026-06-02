#!/usr/bin/env node
// HTTP API wrapper — exposes the catalog-size engine as a one-domain-in → JSON-out
// endpoint for Clay (HTTP API column) / Deepline (generic_http) enrichment.
//
// Thin by design (locked decision #3): all real work is estimateCatalog in
// src/core. This file only does routing, validation, auth, and JSON shaping.
//
// Endpoints:
//   GET  /health                                  → { status: "ok" }
//   GET  /estimate?domain=…&platform=…            → flat JSON result
//   POST /estimate   { domain, platform }         → flat JSON result
//
// Auth: if CATALOG_API_KEY is set, every /estimate request must send
//   Authorization: Bearer <key>   (401 otherwise). If unset, the endpoint is open.

import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { estimateCatalog } from "./core/estimate.js";
import { normalizeDomain } from "./core/util.js";
import type { CatalogEstimate } from "./core/types.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 8080;
const API_KEY = process.env.CATALOG_API_KEY?.trim();

/** Flat, snake_case payload (matches the CSV columns + easy Clay field extraction). */
function toPayload(domain: string, platform: string | null, est: CatalogEstimate) {
  return {
    domain,
    platform: platform || null,
    product_count: est.productCount,
    method: est.method,
    confidence: est.confidence,
    total_urls: est.totalUrls,
    source_url: est.sourceUrl,
    error: est.error,
  };
}

/** Optional bearer-token gate — active only when CATALOG_API_KEY is set. */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) return next();
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token !== API_KEY) {
    res.status(401).json({ status: "error", code: "UNAUTHORIZED", message: "Missing or invalid bearer token" });
    return;
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function handleEstimate(domainRaw: string, platformRaw: string, res: Response): Promise<void> {
  const domain = (domainRaw ?? "").trim();
  if (!domain) {
    res.status(400).json({ status: "error", code: "MISSING_DOMAIN", message: "A 'domain' is required" });
    return;
  }
  const platform = (platformRaw ?? "").trim() || null;
  const est = await estimateCatalog(domain, platform);
  res.json(toPayload(normalizeDomain(domain), platform, est));
}

app.get("/estimate", requireAuth, async (req, res) => {
  await handleEstimate(String(req.query.domain ?? ""), String(req.query.platform ?? ""), res);
});

app.post("/estimate", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  await handleEstimate(String(body.domain ?? ""), String(body.platform ?? ""), res);
});

// JSON 404 + safety-net error handler (keep responses machine-readable for Clay/Deepline).
app.use((_req, res) => res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Unknown route" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ status: "error", code: "INTERNAL", message: err instanceof Error ? err.message : String(err) });
});

app.listen(PORT, () => {
  console.log(`catalog-size API listening on :${PORT} (auth ${API_KEY ? "ON" : "OFF"})`);
});
