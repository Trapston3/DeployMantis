# DeployMantis Architecture Reference

This document provides the authoritative technical reference for DeployMantis service topology, request lifecycle, storage schema, environment configuration, and instructions for developers extending the platform.

## Port Map

The following table lists every service defined in the mesh, its primary host port, internal role, and corresponding definition configuration:

| Service | Port | Role | Owner file |
|---------|------|------|------------|
| `core-api` | 4000 | Central gateway, routing proxy, auth validation, and billing middleware | [core-api/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/core-api/Dockerfile) |
| `strata` | 3000 / 3002 | SSE log ingest / event stream aggregator (3002) and UI debug console (3000) | [Strata/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/Strata/Dockerfile) |
| `vault-guard` | 5001 | Real-time zero-trust PII redactor and credential scanner | [vault-guard/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/vault-guard/Dockerfile) |
| `token-breaker` | 5002 | Per-tenant financial circuit breaker and budget limiter | [token-breaker/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/token-breaker/Dockerfile) |
| `mantis-graph` | 5003 | Code quality engine, AST dependency graph, and style verifier | [mantis-graph/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/mantis-graph/Dockerfile) |
| `swarm-chaos` | 5000 | Chaos injector (latency, hallucinations, and 5xx synthetic failures) | [swarm-chaos/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/swarm-chaos/Dockerfile) |
| `fallback-mesh` | 5004 | Zero-downtime LLM provider gateway with local Ollama fallback | [fallback-mesh/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/fallback-mesh/Dockerfile) |
| `mantis-env` | 8000 | SRE reinforcement learning simulation sandbox and agent benchmark environment | [mantis-env/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/mantis-env/Dockerfile) |
| `odysseus` | 7000 | Control plane workspace coordinator, agent execution loop, and ChromaDB store | [odysseus/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/odysseus/Dockerfile) |
| `mantis-dash` | 3001 | Next.js root control plane UI dashboard | [mantis-dash/Dockerfile](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/mantis-dash/Dockerfile) |
| `postgres` | 5432 (Internal) | Shared multi-tenant relational data store (no host port exposed) | [docker-compose.yml](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/docker-compose.yml) |

---

## Request Lifecycle

The trace of a single client request through the DeployMantis gateway mesh follows these sequential steps:

1. **Client Initiation**: A Developer IDE, UI client, or external agent issues an API request (e.g. sending a git diff to `/api/v1/mantis-verify`) targeting the `core-api` gateway (Port 4000).
2. **BillingMiddleware Execution**: The request is intercepted by FastAPI's `BillingMiddleware` (located in `core-api/auth/middleware.py`).
3. **Key Lookup**: The middleware extracts the `Authorization: Bearer <key>` header and calls `key_store.lookup_key(api_key)` to retrieve the organization metadata.
4. **Auth Fallback / Validation**:
   - If a valid key is found, `tenant_id`, `scopes`, and `org_name` are injected into the request state.
   - If the key is missing or invalid, and `DEPLOYMANTIS_AUTH_REQUIRED=false` is set in the environment, the request is permitted to proceed with `anonymous` tenant ID credentials mapping to the `hobbyist` plan.
   - If `DEPLOYMANTIS_AUTH_REQUIRED=true` is set and credentials are missing, the middleware immediately rejects the request with a `401 Unauthorized` JSON response.
5. **Subscription Plan Lookup**: The middleware fetches active organization subscription details by executing `billing_store.get_billing(tenant_id)`.
6. **Tier Limit Enforcement**:
   - If the request targets a Team-only route (contains `mantis-verify`, `mantis-style`, or `audit` in the path) and the active organization's subscription tier is `hobbyist`, the middleware blocks the call and yields a `402 Upgrade Required` status code.
   - If the plan is `team`, the middleware checks seat counts. It queries `key_store.count_tenant_keys(tenant_id)`. If the number of generated API keys (active seats) exceeds `seats_purchased`, the request is rejected with `402 Upgrade Required`.
7. **Route Handler Routing**: The validated request reaches the target route handler (e.g. `core-api/routers/mantis_verify.py`).
8. **Parallel Scanning**: The router handler triggers concurrent scanning tasks to evaluate the request:
   - **VaultGuard Scan (Branch A)**: The gateway forwards the content to `vault-guard` (Port 5001) for secret detection and PII scrubbing based on the `VAULT_STRICT_MODE` setting.
   - **MantisVerify Scan (Branch B)**: The gateway proxies the code payload to `mantis-graph` (Port 5003) for AST quality signal analysis (convention matching, reuse metrics, risk evaluation).
9. **Trust Score Aggregation**: The handler aggregates the results returned from `vault-guard` and `mantis-graph` to compute a unified code quality verdict:
   - `PASS`: Convention match $\ge$ 0.80 AND risk score $\le$ 0.30.
   - `FAIL`: Risk score $\ge$ 0.70 OR convention match $\le$ 0.40.
   - `WARN`: Any intermediate metric values.
10. **Response Return**: The consolidated trust score, verdict, validation reasons, and diagnostic notes are returned by `core-api` to the calling Developer IDE or UI.

---

## Control Plane vs Data Plane

DeployMantis strictly separates control orchestration and policy enforcement:

- **Odysseus (Control Plane)**: Houses high-level agent execution logic, multi-round tool planning, visual workspace state, ChromaDB vector stores, and interactive chat routing. It decides what code to edit, when to invoke tools, and handles user configurations.
- **Core API (Data Plane)**: The high-speed gateway intercepting inference traffic, validating API keys, checking budgets, injecting chaos, and performing scans.
- **The `.mantishandoff` File Contract**: Since Odysseus (control plane) operates asynchronously from Core API (data plane), they coordinate environment state handoffs using a `.mantishandoff` JSON file located in the shared `/data` volume exchange folder. When Odysseus triggers an environment snapshot, container creation, or agent state shift, it writes the schema details, environment ports, and active agent ID variables to `.mantishandoff`. Core-API monitors this file to auto-update its routing tables, apply tenant-specific policy parameters, and register transient variables without requiring long-lived synchronous connections or database locking.

---

## Database Schema

DeployMantis uses five core tables. The schema mapping and keys are defined as follows:

| Table | Owner service | Mode | Key columns |
|-------|---------------|------|-------------|
| `org_keys` | `core-api` | Shared Postgres / SQLite | `key_hash` (Primary Key), `tenant_id`, `scopes`, `org_name` |
| `org_billing` | `core-api` | Shared Postgres / SQLite | `tenant_id` (Primary Key), `stripe_customer_id`, `plan`, `status`, `seats_purchased` |
| `mantis_snap` | `core-api` | Shared Postgres / SQLite | `snap_id` (Primary Key), `tenant_id`, `branch_name`, `commit_hash`, `context_metadata` |
| `mantis_launch_snapshots` | `core-api` | Shared Postgres / SQLite | `snapshot_id` (Primary Key), `tenant_id`, `environment_id`, `drift_detected`, `last_healthy_state` |
| `migrations` | `core-api` | Shared Postgres / SQLite | `version` (Primary Key), `applied_at` |

### SQLite Fallback Control
DeployMantis supports two database modes resolved via `core-api/db/connection.py`:
- **SQLite Fallback**: Activated if `IS_SQLITE=true` is set in the environment or if `DATABASE_URL` is omitted. Each service operates independently using file-based SQLite engines located inside the service `/data` directory.
- **Shared PostgreSQL**: Default state when `IS_SQLITE=false` and a valid `DATABASE_URL` is present. An asynchronous connection pool is maintained via `asyncpg` with a minimum of 2 and maximum of 10 connections.

---

## Environment Variables

The complete environment configuration keys, defaults, and requirements are derived below:

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `CORE_API_PORT` | `4000` | No | Host port exposed by the `core-api` gateway container. |
| `STRATA_PORT` | `3002` | No | Host port exposed by the Strata SSE log ingestion server. |
| `MANTIS_ENV_PORT` | `8000` | No | Host port exposed by the MantisEnv reinforcement learning sandbox. |
| `STRATA_BUFFER_SIZE` | `50` | No | Maximum number of in-memory logs preserved in the ring buffer. |
| `LOG_LEVEL` | `info` | No | Logging verbosity limit: `debug` \| `info` \| `warn` \| `error`. |
| `CHAOS_PROBABILITY` | `0.05` | No | Fractional chance (0.0 to 1.0) of SwarmChaos synthetic failures. |
| `LATENCY_MS_MAX` | `2000` | No | Maximum delay (in milliseconds) SwarmChaos injects. |
| `MAX_BUDGET` | `1.00` | No | Per-org monetary limit (in USD) enforced by TokenBreaker. |
| `BUDGET_WINDOW_HOURS` | `24` | No | Rolling duration (in hours) used for evaluating the budget cap. |
| `VAULT_STRICT_MODE` | `false` | No | If `true`, VaultGuard blocks API requests containing credentials or PII. |
| `INFERENCE_PROVIDER` | `ollama` | No | Active LLM endpoint driver: `ollama` \| `openai` \| `anthropic` \| `huggingface`. |
| `CUSTOM_MODEL_NAME` | `llama3.2` | No | Target model name passed to the active inference provider. |
| `FALLBACK_MODEL` | `llama3.2` | No | Back-up model executed by FallbackMesh if primary model fails. |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | No | Host domain of the Ollama server accessible from inside containers. |
| `OPENAI_API_KEY` | (empty) | No | OpenAI API secret key credential (`sk-...`). |
| `ANTHROPIC_API_KEY` | (empty) | No | Anthropic API secret key credential (`sk-ant-...`). |
| `HUGGINGFACE_API_KEY` | (empty) | No | Hugging Face user access token credential (`hf_...`). |
| `MANTIS_API_KEY` | (empty) | Yes (prod) | Token used for internal service-to-service authorization. |
| `SECRET_KEY` | `changeme-in-production` | Yes (prod) | Encryption salt for sessions and temporary file operations. |
| `NEXT_PUBLIC_CORE_API_URL` | `http://localhost:4000` | No | Client-accessible URL for the core-api gateway. |
| `NEXT_PUBLIC_STRATA_URL` | `http://localhost:3002` | No | Client-accessible URL for Strata SSE streaming connection. |
| `NEXT_PUBLIC_ODYSSEUS_URL` | `http://localhost:7000` | No | Client-accessible URL for Odysseus control plane. |
| `STRIPE_SECRET_KEY` | (empty) | No (billing) | Stripe Dashboard secret API key (`sk_test_...`). |
| `STRIPE_WEBHOOK_SECRET` | (empty) | No (billing) | Webhook signing key (`whsec_...`) used to authenticate Stripe. |
| `STRIPE_TEST_MODE` | `true` | No | Toggles Stripe API test mode state execution. |
| `STRIPE_TEAM_PRICE_ID` | (empty) | No (billing) | Price SKU code for the Team plan ($39/user/month). |
| `STRIPE_DEV_PRICE_ID` | (empty) | No (billing) | Price SKU code for the Developer plan ($19/month). |
| `BILLING_SUCCESS_URL` | `http://localhost:3001/billing?success=true` | No | Stripe checkout redirect destination on success. |
| `BILLING_CANCEL_URL` | `http://localhost:3001/billing?cancel=true` | No | Stripe checkout redirect destination on cancel. |
| `DEPLOYMANTIS_AUTH_REQUIRED` | `false` | No | If `true`, rejects any gateway calls lacking a valid authorization key. |

---

## Adding a New Microservice (checklist)

Contributors integrating new features or components into the DeployMantis mesh must satisfy the following checklist:

1. [ ] **Service Location**: Define a new service subdirectory (e.g. `mantis-brand`) at the repository root containing clean business logic files.
2. [ ] **Implement Core Entrypoint**: Establish a standard framework runtime script (e.g., `main.py` for FastAPI/Uvicorn, or `index.js` for Node.js).
3. [ ] **Expose Health Endpoint**: Implement a GET `/health` endpoint returning `{"status": "ok", "service": "service-name"}` used for service coordination checks.
4. [ ] **Author the Dockerfile**: Create a standard `Dockerfile` inside the service root directory adhering to the multi-stage, non-root builder pattern.
5. [ ] **Configure Local Dependencies**: Add a lock or requirements manifest (e.g., `requirements.txt` or `package.json`) and compile them inside the Docker container.
6. [ ] **Support SQLite/PostgreSQL Fallback**: Ensure that any storage writes respect the `IS_SQLITE` flag: write to file-based databases inside `/data` if `true`, or leverage the shared `DATABASE_URL` postgres connection pool singleton if `false`.
7. [ ] **Register in docker-compose.yml**: Insert a service block containing build context, container name, host port bindings, internal network bridge assignment (`deploymantis-net`), health checks, and volume mounts.
8. [ ] **Document Environment Variables**: Ensure any new environment variables are documented with sensible fallback values in `.env.example` to prevent configuration drift.
