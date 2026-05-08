# DeployMantis Ecosystem Context for AI Agents

Welcome to **DeployMantis**, an enterprise-grade AI Reliability Suite designed for multi-agent governance, chaos testing, and observability.

## 🏗️ Architecture Overview

DeployMantis uses a **Governance Mesh** (Proxy/Gateway Pattern) to ensure all AI inference and agent actions are audited, sanitized, and budget-capped.

### Core Components
- **`mantis-dash`**: Next.js dashboard providing a central "Root OS" view of all microservices.
- **`core-api`**: The central gateway (FastAPI) that proxies requests to specialized services.
- **`mantis-env`**: A Reinforcement Learning (RL) sandbox where agents are tested against complex topologies.
- **`sdk`**: The Python client (`MantisClient`) used by agents to communicate with the ecosystem.
- **`cli`**: A compiled binary for managing the suite from the terminal.

### Governance Services
- **`Strata`**: Traffic instrumentation and log exporter.
- **`SwarmChaos`**: Injects hallucinations, latency, and 5xx errors to test agent resilience.
- **`VaultGuard`**: Real-time PII redactor using regex patterns to scrub sensitive data.
- **`TokenBreaker`**: Financial circuit breaker that enforces strict budget caps on LLM usage.

## 🚀 Existing Features
- **Centralized Dashboard**: Real-time service health, budget tracking, and micro-app switching.
- **Autonomous Fallback**: The `LLMGateway` automatically switches to local models (Ollama) if primary providers fail.
- **Real-time Configuration**: Chaos injection rates and redaction rules can be updated live from the UI.
- **Trace Replay**: Capture and replay traffic traces for debugging (via Strata).

## 🛠️ Roadmap & "Next Steps"
If you are tasked with extending DeployMantis, consider the following priorities:
1. **Dynamic Rule Engine**: Move from static regex in VaultGuard to AI-powered PII detection.
2. **Chaos Orchestration**: Allow SwarmChaos to target specific agent IDs rather than global injection.
3. **Budget Forecasting**: Add predictive analytics to TokenBreaker to warn users before budget exhaustion.
4. **Agent Benchmarking**: Integrate MantisEnv results into the dashboard to rank agent models by "Survival Score".

## 📜 Global Tokens
CSS tokens are prefixed with `--mantis-`.
Environment variables: `MANTIS_ENV_PORT`, `CORE_API_PORT`, `STRATA_PORT`.

---
*Maintained by the DeployMantis Core Team.*
