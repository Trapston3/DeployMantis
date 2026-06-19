# DeployMantis — Quick Start

Get from zero to a running dashboard in 4 steps. Total time: ~5 minutes.

**Prerequisites**: Docker Desktop (running), Git, `make`, a terminal.

---

## Step 1 — Clone and configure

```bash
git clone <your-repo-url> deploymantis && cd deploymantis
cp .env.example .env
```

Open `.env` and set at least one LLM provider key:

| Setting | What to fill in |
|---|---|
| `OPENAI_API_KEY` | `sk-...` from platform.openai.com |
| `ANTHROPIC_API_KEY` | `sk-ant-...` from console.anthropic.com |
| `OLLAMA_HOST` | Leave as-is if Ollama runs locally on port 11434 |
| `SECRET_KEY` | Any long random string (e.g. `openssl rand -hex 32`) |

> **Zero-cloud option**: Keep `INFERENCE_PROVIDER=ollama` and run
> `ollama pull llama3.2` on your host — no API keys needed.

---

## Step 2 — Build and start the mesh

```bash
make up
```

This builds all images and starts 10 containers in the correct dependency
order. First run takes ~4–8 minutes (image pulls + builds).
Subsequent starts take ~20 seconds.

---

## Step 3 — Verify all services are healthy

```bash
make health
```

Every row should show **✅ OK**. If a service shows ❌, check its logs:

```bash
docker compose logs <service-name> -f
```

---

## Step 4 — Open the dashboard

Navigate to **[http://localhost:3001](http://localhost:3001)** in your browser.

The MantisDash control plane shows real-time service health, budget usage,
and chaos injection controls. The Strata log console is at
**[http://localhost:3000](http://localhost:3000)**.

To generate your first API key for the SDK or CLI:

```bash
make key
```

---

### Common Commands

| Command | Purpose |
|---|---|
| `make up` | Start the full mesh (build + detach) |
| `make down` | Stop and remove all containers |
| `make logs` | Stream all container logs |
| `make health` | Print a live health summary table |
| `make key` | Create a dev API key in core-api |

### Service Port Map

| Service | Host Port | Role |
|---|---|---|
| core-api | 4000 | Central governance gateway |
| vault-guard | 5001 | PII redactor |
| token-breaker | 5002 | Budget circuit breaker |
| mantis-graph | 5003 | Agent dependency graph |
| swarm-chaos | 5000 | Chaos injection |
| fallback-mesh | 5004 | LLM fallback gateway |
| mantis-env | 8000 | RL sandbox |
| odysseus | 7000 | Main AI agent app |
| strata | 3000 / 3002 | Log console / SSE ingest |
| mantis-dash | 3001 | Control-plane dashboard |
