import os
import tiktoken
import json
from datetime import datetime

class CircuitBreaker:
    def __init__(self):
        self.ledger = {}
        self.max_budget = float(os.getenv("MAX_BUDGET", "1.00"))
        self.total_tokens_used = 0
        self.tokens_limit = int(self.max_budget * 100000)
        self.by_model = {}
        self.by_agent = {}
        self.entries = []
        
        # We try to use tiktoken, but if there's an issue loading the encoder,
        # we can fall back to the simple heuristic.
        import socket
        orig_timeout = socket.getdefaulttimeout()
        try:
            socket.setdefaulttimeout(1.0)
            self.encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self.encoder = None
        finally:
            socket.setdefaulttimeout(orig_timeout)

    def estimate_cost(self, payload: dict) -> float:
        """Estimates the cost of a payload at $0.01 per 1000 tokens."""
        tokens = self.estimate_tokens(payload)
        return (tokens / 1000.0) * 0.01

    def estimate_tokens(self, payload: dict) -> int:
        """Estimates token count for the payload."""
        payload_str = json.dumps(payload)
        if self.encoder:
            try:
                return len(self.encoder.encode(payload_str))
            except Exception:
                pass
        # High-speed string length / whitespace split estimator fallback
        words = payload_str.split()
        word_estimate = len(words) * 1.3
        char_estimate = len(payload_str) / 4.0
        return max(1, int((word_estimate + char_estimate) / 2.0))

    def charge_agent(self, agent_id: str, cost: float, model_id: str = "unknown-model", tokens: int = 0) -> bool:
        """Adds cost to agent's ledger. Returns False if this exceeds max budget."""
        current_spend = self.ledger.get(agent_id, 0.0)
        
        if current_spend + cost > self.max_budget:
            return False
            
        self.ledger[agent_id] = current_spend + cost
        self.total_tokens_used += tokens
        self.by_model[model_id] = self.by_model.get(model_id, 0) + tokens
        self.by_agent[agent_id] = self.by_agent.get(agent_id, 0) + tokens
        
        import time
        self.entries.append({
            "time": time.time(),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "agent_id": agent_id,
            "model_id": model_id,
            "tokens": tokens,
            "cost": cost
        })
        return True

    def is_blocked(self, agent_id: str) -> bool:
        """Checks if the agent has already hit the budget."""
        return self.ledger.get(agent_id, 0.0) >= self.max_budget

    def get_ledger(self) -> dict:
        return self.ledger

    def get_current_rates(self) -> dict:
        import time
        now = time.time()
        one_min_ago = now - 60.0
        
        active_entries = [e for e in self.entries if e["time"] >= one_min_ago]
        tpm = sum(e["tokens"] for e in active_entries)
        rpm = len(active_entries)
        
        tpm_limit = 50000
        rpm_limit = 100
        
        return {
            "tpm": tpm,
            "rpm": rpm,
            "tpm_limit": tpm_limit,
            "rpm_limit": rpm_limit,
            "tpm_saturation": min(100.0, (tpm / tpm_limit) * 100.0) if tpm_limit > 0 else 0.0,
            "rpm_saturation": min(100.0, (rpm / rpm_limit) * 100.0) if rpm_limit > 0 else 0.0
        }

breaker = CircuitBreaker()

