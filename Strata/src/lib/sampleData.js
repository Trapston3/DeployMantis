const now = Date.now();

function minutesAgo(minutes) {
  return new Date(now - minutes * 60_000).toISOString();
}

export const logs = [
  {
    id: "log-001",
    timestamp: minutesAgo(2),
    service: "payments",
    level: "error",
    message: "Stripe charge request timed out after 12s",
    errorCode: "PAYMENT_TIMEOUT"
  },
  {
    id: "log-002",
    timestamp: minutesAgo(3),
    service: "payments",
    level: "error",
    message: "Stripe charge request timed out after 12s",
    errorCode: "PAYMENT_TIMEOUT"
  },
  {
    id: "log-003",
    timestamp: minutesAgo(4),
    service: "payments",
    level: "warn",
    message: "Retrying payment confirmation request",
    errorCode: "PAYMENT_RETRY"
  },
  {
    id: "log-004",
    timestamp: minutesAgo(6),
    service: "auth",
    level: "error",
    message: "JWT verification failed for refresh token",
    errorCode: "TOKEN_INVALID"
  },
  {
    id: "log-005",
    timestamp: minutesAgo(8),
    service: "auth",
    level: "error",
    message: "JWT verification failed for refresh token",
    errorCode: "TOKEN_INVALID"
  },
  {
    id: "log-006",
    timestamp: minutesAgo(9),
    service: "gateway",
    level: "error",
    message: "Upstream service returned 502 for POST /checkout",
    errorCode: "UPSTREAM_502"
  },
  {
    id: "log-007",
    timestamp: minutesAgo(10),
    service: "gateway",
    level: "error",
    message: "Upstream service returned 502 for POST /checkout",
    errorCode: "UPSTREAM_502"
  },
  {
    id: "log-008",
    timestamp: minutesAgo(11),
    service: "gateway",
    level: "warn",
    message: "Latency spike detected for POST /checkout",
    errorCode: "LATENCY_SPIKE"
  },
  {
    id: "log-009",
    timestamp: minutesAgo(14),
    service: "payments",
    level: "info",
    message: "Recovered payment processor connection",
    errorCode: "RECOVERY_NOTICE"
  }
];
