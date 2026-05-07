import express from "express";
import pinoHttp from "pino-http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { buildIncidents } from "./lib/incidents.js";
import { logger } from "./lib/logger.js";
import { TemporalDebugger } from "./lib/TemporalDebugger.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "..", "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const services = ["gateway", "auth", "payments"];

const app = express();
app.set("trust proxy", true);

const temporalDebugger = new TemporalDebugger();

const metricsState = {
  requestCount: 0,
  requestCounters: new Map()
};

export function sanitizePath(path) {
  if (!path) return "/";
  return path.split("?")[0] || "/";
}

function inferService(pathname) {
  const path = pathname.toLowerCase();
  if (path.includes("auth")) return "auth";
  if (path.includes("payment")) return "payments";
  return "gateway";
}

export function inferErrorCode(statusCode, pathname) {
  if (statusCode >= 500) return "HTTP_500";
  if (statusCode === 404) return "HTTP_404";
  if (statusCode === 403) return "HTTP_403";
  if (statusCode === 401) return "HTTP_401";
  if (pathname === "/metrics") return "PROMETHEUS_SCRAPE";
  if (pathname === "/health") return "HEALTH_PROBE";
  return "HTTP_OK";
}

function buildLogEntry({
  reqId,
  method,
  path,
  statusCode,
  responseTimeMs,
  clientIp,
  headers,
  body
}) {
  const service = "gateway";
  const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
  const latencyMs = Number(responseTimeMs.toFixed(2));

  return {
    id: `${reqId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    service,
    url: path,
    status: statusCode,
    responseTime: latencyMs,
    level,
    message: `${method} ${path} -> ${statusCode} in ${latencyMs}ms`,
    errorCode: inferErrorCode(statusCode, path),
    method,
    path,
    statusCode,
    responseTimeMs: latencyMs,
    latencyMs,
    clientIp,
    headers,
    body
  };
}

function getLogs() {
  return temporalDebugger.getSnapshot().frames;
}

function appendLog(entry) {
  temporalDebugger.push(entry);
}

function observeMetrics(method, path, statusCode) {
  metricsState.requestCount += 1;

  const counterKey = `${method}:${path}:${statusCode}`;
  metricsState.requestCounters.set(counterKey, (metricsState.requestCounters.get(counterKey) || 0) + 1);
}

function renderPrometheusMetrics() {
  const lines = [
    "# HELP http_requests_total Total number of HTTP requests.",
    "# TYPE http_requests_total counter"
  ];

  for (const [key, value] of metricsState.requestCounters.entries()) {
    const [method, path, status] = key.split(":");
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${value}`);
  }

  lines.push("# HELP process_heap_used_bytes Process heap currently used.");
  lines.push("# TYPE process_heap_used_bytes gauge");
  lines.push(`process_heap_used_bytes ${process.memoryUsage().heapUsed}`);

  return `${lines.join("\n")}\n`;
}

function getRuntimeSnapshot() {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const uptime = process.uptime();
  const totalMemoryMb = memoryUsage.rss / 1024 / 1024;
  const heapUsedMb = memoryUsage.heapUsed / 1024 / 1024;
  const cpuPercent = Math.min(100, Math.round(((cpuUsage.user + cpuUsage.system) / 1_000_000) / Math.max(uptime, 1) * 100));
  const memoryPercent = Math.min(100, Math.round((heapUsedMb / Math.max(totalMemoryMb, 1)) * 100));

  return {
    status: "UP",
    uptime,
    memory: memoryUsage,
    processID: process.pid,
    requestCount: metricsState.requestCount,
    cpuUsage,
    cpuPercent,
    memoryUsage,
    memoryPercent,
    services,
    logBufferSize: temporalDebugger.getSnapshot().currentSize
  };
}

app.use(express.json({ limit: "1mb" }));

app.use(pinoHttp({
  logger,
  genReqId: (req, res) => req.headers["x-request-id"] || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  customSuccessMessage: () => "request completed",
  customErrorMessage: () => "request failed"
}));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const path = sanitizePath(req.originalUrl || req.url);
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";
    const entry = buildLogEntry({
      reqId: req.id,
      method: req.method,
      path,
      statusCode: res.statusCode,
      responseTimeMs: elapsed,
      clientIp,
      headers: req.headers,
      body: req.body
    });

    appendLog(entry);
    observeMetrics(req.method, path, res.statusCode);

    const logFn = res.statusCode >= 500 ? req.log.error.bind(req.log) : req.log.info.bind(req.log);
    logFn({
      reqId: req.id,
      method: req.method,
      path,
      statusCode: res.statusCode,
      latencyMs: entry.latencyMs,
      clientIp
    }, "request observed");
  });

  next();
});

app.get("/health", (req, res) => {
  const snapshot = getRuntimeSnapshot();
  res.status(200).json({
    uptime: snapshot.uptime,
    memory: process.memoryUsage(),
    processID: process.pid
  });
});

app.get("/metrics", (req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(renderPrometheusMetrics());
});

app.get("/api/logs", (req, res) => {
  res.status(200).json(getLogs());
});

app.delete("/api/logs", (req, res) => {
  temporalDebugger.purge();
  req.log.info({ reqId: req.id }, "log buffer purged");
  res.status(204).end();
});

// ── BYOD: Accept externally pushed log frames ──────────────
app.post("/api/logs", (req, res) => {
  const frame = req.body;
  if (!frame || typeof frame !== "object" || !frame.message) {
    return res.status(400).json({ error: "Invalid frame: 'message' field is required" });
  }
  // Ensure essential fields have defaults
  frame.id = frame.id || `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  frame.timestamp = frame.timestamp || new Date().toISOString();
  frame.level = frame.level || "info";
  frame.service = frame.service || "external";

  temporalDebugger.push(frame);
  req.log.info({ frameId: frame.id }, "external frame ingested");
  res.status(201).json({ status: "ingested", id: frame.id });
});

app.get("/api/debugger/frames", (req, res) => {
  res.status(200).json(temporalDebugger.getSnapshot());
});

app.delete("/api/debugger/frames", (req, res) => {
  temporalDebugger.purge();
  req.log.info({ reqId: req.id }, "debugger frames purged");
  res.status(204).end();
});

app.get("/api/incidents", (req, res) => {
  res.status(200).json({ incidents: buildIncidents(getLogs()) });
});

app.use(express.static(publicDir));

app.use((req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

let server;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server = app.listen(port, host, () => {
    logger.info({ host, port }, "strata listening");
  });
}

export { app, server };
