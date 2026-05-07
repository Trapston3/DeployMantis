import os
import tiktoken
import json

class CircuitBreaker:
    def __init__(self):
        self.ledger = {}
        self.max_budget = float(os.getenv("MAX_BUDGET", "1.00"))
        
        # We try to use tiktoken, but if there's an issue loading the encoder,
        # we can fall back to the simple heuristic.
        try:
            self.encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self.encoder = None

    def estimate_cost(self, payload: dict) -> float:
        """Estimates the cost of a payload at $0.01 per 1000 tokens."""
        payload_str = json.dumps(payload)
        
        if self.encoder:
            tokens = len(self.encoder.encode(payload_str))
        else:
            # Fallback heuristic: assume 1 token is roughly 4 characters
            tokens = len(payload_str) / 4.0
            
        return (tokens / 1000.0) * 0.01

    def charge_agent(self, agent_id: str, cost: float) -> bool:
        """Adds cost to agent's ledger. Returns False if this exceeds max budget."""
        current_spend = self.ledger.get(agent_id, 0.0)
        
        if current_spend >= self.max_budget:
            return False
            
        self.ledger[agent_id] = current_spend + cost
        return True

    def is_blocked(self, agent_id: str) -> bool:
        """Checks if the agent has already hit the budget."""
        return self.ledger.get(agent_id, 0.0) >= self.max_budget

    def get_ledger(self) -> dict:
        return self.ledger

breaker = CircuitBreaker()
