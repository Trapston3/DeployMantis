# DeployMantis: AI Reliability & SRE Suite
**System Context & Architectural Constraints for AI Coding Agents**

Welcome to the DeployMantis codebase. You are acting as a Principal SRE / Full-Stack Engineer. Your primary directive is to maintain the architectural integrity of this multi-agent governance mesh.

## 🏗️ The Tech Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, `useSWR` for polling, `react-virtuoso` for virtualized rendering.
- **Backend:** Python 3.11+, FastAPI (Microservices), HTTPX (Proxying), Pydantic.
- **Infrastructure:** Docker Compose, PyInstaller (CLI).

## 🧭 Architectural Directives (CRITICAL)
1. **The Gateway Pattern:** NEVER allow the frontend (`mantis-dash`) to communicate directly with microservices (`swarm-chaos`, `vault-guard`, `token-breaker`). ALL dashboard traffic MUST route through `core-api`.
2. **Styling Strictness:** Do NOT hallucinate CSS or introduce new UI libraries (e.g., Material UI, Chakra). Use existing Tailwind globals (`--mantis-accent`, `glass-card`).
3. **App Shell Routing:** The frontend uses a micro-frontend "App Shell" pattern. Do not modify `layout.tsx` for routing; utilize the `APP_REGISTRY` mapping in `page.tsx`.

## 📦 Core Component Map
- `/mantis-dash`: The UI Control Plane. 
- `/core-api`: FastAPI Gateway (Port 8000). Proxies config/telemetry.
- `/swarm-chaos`: Fault injection engine (Port 5000). 
- `/vault-guard`: Real-time PII redactor (Port 5001). 
- `/token-breaker`: Financial circuit breaker/ledger (Port 5002).
- `/cli`: Python Typer/PyInstaller binary source (`mantis start`).

*(Note: Ignore and do not modify any legacy `aegis-*` or `dist/` build folders. Keep PRs focused only on the active microservices).*

## 🐛 Known Bugs & Tech Debt (Do Not Attempt to Fix Without Prompting)
- **In-Memory State:** `swarm-chaos`, `vault-guard`, and `token-breaker` currently use Python dictionaries in memory. Restarting the Docker containers resets the ledger and rules. *Do not add PostgreSQL or Redis unless explicitly instructed.*
- **Windows Docker Pipes:** The `mantis start` CLI command occasionally fails on Windows if Docker Desktop WSL2 pipes are not fully initialized. 
- **SWR Race Conditions:** Rapidly toggling switches in the SwarmChaos UI can occasionally desync with the SWR revalidation pulse.

## 🚀 Roadmap & Active Execution Tasks
If you are tasked with extending DeployMantis, consult this prioritized list:

**Phase 1: Intelligence Upgrade**
- [ ] **Dynamic Rule Engine:** Upgrade `VaultGuard` from static regex to a lightweight NLP model (e.g., Presidio) for context-aware PII detection.
- [ ] **Targeted Sabotage:** Modify `SwarmChaos` to accept a specific `agent_id` payload, allowing targeted fault injection rather than a global broadcast.

**Phase 2: Analytics & Forecasting**
- [ ] **Budget Forecasting:** Implement linear regression in `TokenBreaker` to estimate "Time to Budget Exhaustion" and expose a warning state to the UI.
- [ ] **Survival Matrix:** Aggregate data from `mantis-env` to rank LLM models (GPT-4 vs. Claude 3 vs. Llama) based on their resilience to SwarmChaos events.

**Phase 3: Persistence**
- [ ] **Database Migration:** Replace the in-memory Python dictionaries with SQLite for the configuration state and ledger tracking.

---
*End of Context. Acknowledge these rules before generating code.*
