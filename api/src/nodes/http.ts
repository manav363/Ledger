import type { NodeHandler } from "./types.js";

interface HttpConfig {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

// ponytail: no SSRF allowlist — an automation engine making arbitrary HTTP
// calls is the feature. Add an allowlist/denylist here when this runs untrusted
// workflow definitions.
function parseConfig(config: Record<string, unknown>, nodeId: string): HttpConfig {
  const url = config.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`http node '${nodeId}': config.url is required`);
  }
  const cfg: HttpConfig = { url };
  if (typeof config.method === "string") cfg.method = config.method;
  if (config.headers && typeof config.headers === "object") {
    cfg.headers = config.headers as Record<string, string>;
  }
  if (config.body !== undefined) cfg.body = config.body;
  return cfg;
}

export const httpNode: NodeHandler = async (node) => {
  const cfg = parseConfig(node.config, node.id);
  const method = (cfg.method ?? "GET").toUpperCase();

  const init: RequestInit = { method };
  const headers: Record<string, string> = { ...cfg.headers };
  if (cfg.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof cfg.body === "string") {
      init.body = cfg.body;
    } else {
      init.body = JSON.stringify(cfg.body);
      headers["content-type"] ??= "application/json";
    }
  }
  init.headers = headers;

  // A completed response — including 4xx/5xx — is a result, captured as output.
  // Only transport failures (DNS/refused/timeout) throw, which drives retry.
  const res = await fetch(cfg.url, init);
  const text = await res.text();
  let body: unknown = text;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text if the server lied about content-type
    }
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: Object.fromEntries(res.headers),
    body,
  };
};
