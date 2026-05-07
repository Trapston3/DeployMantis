# Strata

Strata is a self-observing SRE platform that instruments its own HTTP traffic, exports structured logs and Prometheus metrics, visualizes live cluster and security posture, and provides incident-response workflows through a browser-based control plane.


## What This Demonstrates

- Observability-as-Code with request middleware instrumentation
- Structured JSON logging via `pino` and `pino-http`
- Prometheus-style `/metrics` exposure for request counters and latency histograms
- Liveness and readiness visibility through `/health`
- Zero-downtime readiness patterns through canary-style rollout simulation and health-driven UI states
- Full-stack incident response UX backed by actual backend telemetry instead of mock traffic

## Core Features

- Real-time request interception for every request hitting the server
- Live `/api/logs` buffer populated from actual site traffic
- Incident grouping and severity scoring from runtime errors
- Cluster tab showing live CPU and memory pressure from backend process metrics
- Security tab showing WAF analytics, blocked clients, top requested paths, and scan spikes
- SRE bot that can answer runtime health questions from live `/health` and `/metrics`
- Prometheus/OpenMetrics text endpoint at `/metrics`

## Runtime Endpoints

- `GET /health`
- `GET /metrics`
- `GET /api/logs`
- `DELETE /api/logs`
- `GET /api/incidents`

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

For development:

```bash
npm run dev
```

## CI/CD

GitHub Actions pipeline:

- installs dependencies
- runs `npm test`
- simulates containerization with `docker build -t strata .`
- simulates deployment with a production-cluster deploy step

See [main.yml](/home/ojesus/projectt/.github/workflows/main.yml).

## Architecture Notes

- The backend uses Express middleware to capture method, path, status, latency, and proxy-aware client IP.
- Logs are stored in-memory for dashboard visualization and incident correlation.
- Prometheus metrics are exported in text format for counters and request-duration histograms.
- The frontend polls live APIs and re-renders runtime-aware SRE views without simulated traffic sources.
