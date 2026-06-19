# DeployMantis Contributing Guidelines

Thank you for contributing to DeployMantis. This document defines the development workflow, coding rules, and submission process for contributing to the repository.

## Prerequisites

Before setting up your local environment, ensure you have installed:
- **Docker Desktop** (running, with support for Linux containers)
- **Python 3.11+**
- **Node.js 20+**
- **stripe CLI** (optional, required only for testing local Stripe webhook handlers)

---

## Local Dev Without Docker

To facilitate rapid development and debugging, you can run the DeployMantis mesh services on your host machine without Docker.

Set `IS_SQLITE=true` in your shell environment. This directs `core-api` to bypass PostgreSQL and use embedded SQLite stores.

### Start Order and Commands

You must start the services in the following order:

1. **Strata (Logs & Event Stream)**
   ```bash
   cd Strata
   npm install
   npm run dev
   ```
   *Listens on ports `3000` (UI) and `3002` (SSE log ingestion).*

2. **Core API Gateway**
   ```bash
   cd core-api
   pip install -r requirements.txt
   $env:IS_SQLITE="true"
   python -m uvicorn main:app --host 0.0.0.0 --port 4000
   ```
   *Runs migrations and listens on port `4000` (host-facing gateway API).*

3. **Validation & Support Mesh Services**
   Open separate terminals to execute the auxiliary engines:
   - **SwarmChaos** (Port 5000):
     ```bash
     cd swarm-chaos && python -m uvicorn main:app --host 0.0.0.0 --port 5000
     ```
   - **VaultGuard** (Port 5001):
     ```bash
     cd vault-guard && python -m uvicorn main:app --host 0.0.0.0 --port 5001
     ```
   - **TokenBreaker** (Port 5002):
     ```bash
     cd token-breaker && python -m uvicorn main:app --host 0.0.0.0 --port 5002
     ```
   - **MantisGraph** (Port 5003):
     ```bash
     cd mantis-graph && python -m uvicorn main:app --host 0.0.0.0 --port 5003
     ```
   - **FallbackMesh** (Port 5004):
     ```bash
     cd fallback-mesh && python -m uvicorn main:app --host 0.0.0.0 --port 5004
     ```
   - **MantisEnv** (Port 8000):
     ```bash
     cd mantis-env && python -m uvicorn main:app --host 0.0.0.0 --port 8000
     ```

4. **Odysseus Agent Application**
   ```bash
   cd odysseus
   pip install -r requirements.txt
   python -m uvicorn main:app --host 0.0.0.0 --port 7000
   ```
   *Listens on port `7000`.*

5. **MantisDash Control Plane**
   ```bash
   cd mantis-dash
   npm install
   npm run dev
   ```
   *Exposes the Next.js control plane dashboard on [http://localhost:3001](http://localhost:3001).*

---

## Code Rules (non-negotiable)

All contributions must strictly adhere to these four core rules:

1. **XSS**: Use `.textContent` only — never `.innerHTML` for rendering dynamic content in any web UI.
2. **Zero-trust**: Never log raw API keys — always log `key_prefix` (the first 8 characters) to keep telemetry secure.
3. **Latency**: Any new middleware added to `core-api` must add less than 2ms of overhead per request.
4. **Dependencies**: Do not add new pip packages to `requirements.txt` without a one-line justification comment immediately above the import.

---

## Branch Naming

Branches must use one of the following formats:
- `feat/<name>`
- `fix/<name>`
- `phase/<N>-<name>` (e.g. `phase/7-billing-integration`)

---

## PR Checklist

Every pull request must fulfill these 5 criteria before being reviewed:

1. [ ] **Design Snapshot**: Design Snapshot comment is generated and attached to the PR discussion.
2. [ ] **Verification Results**: Manual or automated verification run logs are appended to the PR description.
3. [ ] **Secret Scan**: Checked diff to ensure no raw secrets or private API credentials are in code.
4. [ ] **DB Engine Verification**: Changes have been tested and verify correctly under both `IS_SQLITE=true` and PostgreSQL.
5. [ ] **Changelog Registration**: A one-line description of the feature or bug fix is added to the relevant section of `CHANGELOG.md`.

---

## Agent Prompt Workflow

DeployMantis uses a phase-based agent prompt system to orchestrate complex development and testing sequences. Prompts are stored in the [docs/agent-prompts/](file:///c:/Users/traps/Downloads/ResumeProjects/AI-Suite/docs/agent-prompts/) directory and represent structured blueprints for code synthesis. Each phase guides the agent through a strict pipeline of Design Snapshot (to establish intent), Code Generation (for implementation), and a final Verification Checklist (for execution validation). This ensures that every automated step is deterministic and verifiable.
