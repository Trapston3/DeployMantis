# ============================================================
#  DeployMantis – Makefile
#  Requires: GNU make (Linux/macOS) or nmake / Chocolatey make (Windows)
#  Docker Desktop must be running before any target is executed.
# ============================================================

.PHONY: up down logs key health

# ── Bring the full mesh online (build images, then start detached) ──
up:
	docker compose up --build -d

# ── Tear the mesh down (stops & removes containers, networks) ──
down:
	docker compose down

# ── Stream logs from every container ─────────────────────────
logs:
	docker compose logs -f

# ── Generate an API key for the dev organisation ─────────────
key:
	docker compose exec core-api python scripts/create_key.py --org dev

# ── Probe every /health endpoint and print a summary table ───
health:
	@echo ""
	@echo "========================================================"
	@echo "  DeployMantis — Health Check Summary"
	@echo "========================================================"
	@echo ""
	@printf "%-20s %-10s %s\n" "Service" "Status" "Response"
	@printf "%-20s %-10s %s\n" "-------" "------" "--------"
	@for endpoint in \
	    "core-api|http://localhost:4000/health" \
	    "vault-guard|http://localhost:5001/health" \
	    "token-breaker|http://localhost:5002/health" \
	    "mantis-graph|http://localhost:5003/health" \
	    "swarm-chaos|http://localhost:5000/health" \
	    "fallback-mesh|http://localhost:5004/health" \
	    "mantis-env|http://localhost:8000/health" \
	    "odysseus|http://localhost:7000/api/health" \
	    "strata|http://localhost:3000/health" \
	    "mantis-dash|http://localhost:3001"; do \
	    svc=$$(echo $$endpoint | cut -d'|' -f1); \
	    url=$$(echo $$endpoint | cut -d'|' -f2); \
	    code=$$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$$url" 2>/dev/null || echo "ERR"); \
	    if [ "$$code" = "200" ]; then \
	        status="✅ OK"; \
	    else \
	        status="❌ $$code"; \
	    fi; \
	    printf "%-20s %-10s %s\n" "$$svc" "$$status" "$$url"; \
	done
	@echo ""
