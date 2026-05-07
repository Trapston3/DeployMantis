const routerViewContainer = document.getElementById("router-view-container");
const commandPalette = document.getElementById("command-palette");
const closeCommandPalette = document.getElementById("close-command-palette");
const commandInput = document.getElementById("command-input");
const commandList = document.getElementById("command-list");
const ambientAnxiety = document.querySelector(".ambient-anxiety");
const supportModal = document.getElementById("support-modal");
const closeSupportModalButton = document.getElementById("close-support-modal");
const supportSearchInput = document.getElementById("support-search-input");
const supportResults = document.getElementById("support-results");
const supportApiTerminal = document.getElementById("support-api-terminal");
const degradedOverlay = document.getElementById("degraded-overlay");
const opsTerminal = document.getElementById("ops-terminal");
const closeOpsTerminal = document.getElementById("close-ops-terminal");
const opsTerminalOutput = document.getElementById("ops-terminal-output");
const opsTerminalInput = document.getElementById("ops-terminal-input");
const UPGRADE_TERMINAL_LINES = [
  "[ OK ] Strata Kernel .... integrity sealed",
  "[ OK ] Aurora Lattice .... synchronized",
  "[ OK ] Command Fabric .... mounted",
  "[ OK ] Incident Refractions .... calibrated",
  "[ OK ] Security Radar .... responsive",
  "[ OK ] Deployment Mesh .... hot-swapped"
];

const state = {
  pollHandle: null,
  isLoading: false,
  chartSeries: [],
  criticalSpikeTimeout: null,
  orbIdleTimeout: null,
  isFocusModeLocked: false,
  currentRoute: "#dashboard",
  latestLogs: [],
  latestIncidents: [],
  latestHealth: null,
  latestMetricsText: "",
  lastSeenLogId: "",
  topologyNodes: [],
  topologyEdges: [],
  topologyRaf: null,
  topologyMouse: { x: -9999, y: -9999 },
  filteredCommands: [],
  selectedIndex: 0,
  seenSecurityIds: new Set(),
  latencyDetailedView: false,
  globalFilter: "",
  lastThreatCount: 0,
  upgradeInProgress: false,
  upgradeBootInterval: null,
  dataPollHandle: null,
  replayIndex: null,
  followLogsInterval: null,
  simulateLoadInterval: null,
  simulateLoadTimeout: null,
  selectedTopologyService: null,
  selectedRunbookCode: "",
  radarBlips: [],
  canvasState: {},
  incidentMode: "normal",
  remediationTimers: [],
  deploymentStep: 0,
  trafficBars: Array.from({ length: 15 }, () => 32),
  supportEntries: [
    { title: "Routing Pipelines", tags: "deployments ci cd release", copy: "Inspect live rollout topology, flashing nodes, and pipeline stage orchestration." },
    { title: "Security Sweep", tags: "security radar threat intrusion firewall", copy: "Review live intrusion stream events, threat counters, and firewall integrity telemetry." },
    { title: "Incident Refractions", tags: "dashboard incidents logs latency payments gateway auth", copy: "Correlate severity scoring, logs, pressure vector, and service sparks in one surface." }
  ]
};

let isReplaying = false;
let systemStateHistory = [];
let telemetryTickCount = 0;
let currentLogs = [];
let currentIncidents = [];
let currentCpu = 0;
let currentMem = 0;
let currentLat = 92;
let currentTelemetryTimestamp = Date.now();
let currentTrafficBars = Array.from({ length: 15 }, () => 32);
let currentDeploymentStep = 0;

const RUNBOOKS = {
  AUTH_TIMEOUT: "Restart auth replicas, clear stale sessions, and inspect token issuer latency before reopening ingress.",
  PAYMENT_RETRY_EXHAUSTED: "Drain failed payment workers, replay dead-letter jobs, and verify downstream settlement health.",
  GATEWAY_403: "Inspect WAF ruleset, confirm client token integrity, and validate edge ACL propagation.",
  CRITICAL_ERROR: "Declare incident, freeze rollout, collect pod diagnostics, and engage rollback automation."
};

const TELEMETRY_SERVICES = ["gateway", "auth", "payments"];
const TELEMETRY_PATHS = ["/", "/api/auth/session", "/api/payments/charge", "/api/gateway/edge", "/login", "/metrics"];
const TELEMETRY_MESSAGES = {
  gateway: ["Ingress stable", "Route rebalance applied", "Edge token validated", "North-south traffic normalized"],
  auth: ["Session cache warm", "Token mint completed", "Identity check queued", "Auth circuit stable"],
  payments: ["Settlement worker drained", "Retry lane recovered", "Charge authorization passed", "Ledger write confirmed"]
};
const INCIDENT_LIBRARY = [
  { service: "gateway", errorCode: "EDGE_TIMEOUT", summary: "Edge nodes are shedding requests while upstream latency climbs." },
  { service: "auth", errorCode: "AUTH_QUEUE_BACKUP", summary: "Identity sessions are queuing behind token signer pressure." },
  { service: "payments", errorCode: "PAYMENT_RETRY_EXHAUSTED", summary: "Settlement retries are saturating the payment lane." }
];

class ServiceNode {
  constructor({ id, x, y, color, label }) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.velocityX = 0;
    this.velocityY = 0;
    this.color = color;
    this.label = label;
    this.radius = 8;
    this.pulseRadius = 0;
    this.isHot = false;
    this.hotTimer = 0;
    this.statusLabel = "Ready";
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseTimestamp(timestamp) {
  return Date.parse(timestamp || new Date().toISOString());
}

function hexToRgbString(hex) {
  const normalized = hex.replace("#", "");
  const int = Number.parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `${r}, ${g}, ${b}`;
}

function setPrimaryGlow(hex) {
  document.documentElement.style.setProperty("--primary-glow", hex);
  document.documentElement.style.setProperty("--primary-rgb", hexToRgbString(hex));
}

function getCurrentRoute() {
  const hash = window.location.hash || "#dashboard";
  if (hash === "#deployments") return "#cluster";
  if (hash === "#logs") return "#security";
  return ["#dashboard", "#cluster", "#security", "#upgrade"].includes(hash) ? hash : "#dashboard";
}

function severityClass(severity) {
  return `severity-${severity}`;
}

function severityTone(severity) {
  if (severity === "critical") return "Critical";
  if (severity === "high") return "Elevated";
  if (severity === "medium") return "Watch";
  return "Nominal";
}

function buildLiveSnapshot() {
  return {
    logs: structuredClone(currentLogs),
    incidents: structuredClone(currentIncidents),
    cpu: currentCpu,
    memory: currentMem,
    latency: currentLat,
    trafficBars: structuredClone(currentTrafficBars),
    deploymentStep: currentDeploymentStep,
    timestamp: currentTelemetryTimestamp
  };
}

function deriveHistoricalIncidents(logs) {
  const errorLogs = logs.filter((log) => log.level === "error");
  const warnLogs = logs.filter((log) => log.level === "warn");
  const referenceLogs = errorLogs.length > 0 ? errorLogs : warnLogs.length > 0 ? warnLogs : logs;

  return INCIDENT_LIBRARY.map((incident, index) => {
    const log = referenceLogs[index] || logs[index] || logs[0];
    const severity = errorLogs.length > 0 ? "critical" : warnLogs.length > 0 ? (index === 0 ? "high" : "medium") : "medium";
    return {
      ...incident,
      score: severity === "critical" ? 94 - index * 3 : 72 - index * 4,
      eventCount: Math.max(3, referenceLogs.length * 2 - index * 2),
      severity,
      latestTimestamp: log?.timestamp || new Date().toISOString(),
      summary: log?.message || incident.summary
    };
  });
}

function deriveHistoricalTrafficBars(snapshot) {
  const base = clamp(Math.round((snapshot.cpu * 0.45) + (snapshot.memory * 0.35) + (snapshot.latency / 20)), 20, 100);
  return Array.from({ length: 15 }, (_, index) => clamp(base + ((index % 5) - 2) * 5, 20, 100));
}

function buildHistoricalRenderSnapshot(snapshot) {
  return {
    ...structuredClone(snapshot),
    incidents: deriveHistoricalIncidents(snapshot.logs || []),
    trafficBars: deriveHistoricalTrafficBars(snapshot),
    deploymentStep: snapshot.latency > 300 ? 1 : snapshot.latency > 140 ? 2 : 3
  };
}

function getActiveSnapshot() {
  if (isReplaying && state.replayIndex !== null && systemStateHistory[state.replayIndex]) {
    return buildHistoricalRenderSnapshot(systemStateHistory[state.replayIndex]);
  }
  return buildLiveSnapshot();
}

function getErrorRate(logs) {
  const sample = logs.slice(0, 100);
  if (sample.length === 0) return 0;
  return sample.filter((log) => log.level === "error").length / sample.length;
}

function parseMetricsCounter(metricsText, metricName) {
  return metricsText
    .split("\n")
    .filter((line) => line.startsWith(`${metricName}{`))
    .reduce((total, line) => {
      const value = Number(line.trim().split(" ").pop() || "0");
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function getMemoryPressurePercent(health = state.latestHealth || {}) {
  if (Number.isFinite(health.memoryPercent)) return clamp(Math.round(health.memoryPercent), 0, 100);
  const rss = Number(health.memory?.rss || health.memoryUsage?.rss || 0);
  const heapUsed = Number(health.memory?.heapUsed || health.memoryUsage?.heapUsed || 0);
  if (rss <= 0 || heapUsed <= 0) return 0;
  return clamp(Math.round((heapUsed / rss) * 100), 0, 100);
}

function getHeapUsedMegabytes(health = state.latestHealth || {}) {
  const heapUsed = Number(health.memory?.heapUsed || health.memoryUsage?.heapUsed || 0);
  return Math.round(heapUsed / 1024 / 1024);
}

function deriveTrafficCoordinate(log) {
  const path = (log?.path || log?.url || "/").toLowerCase();
  if (path.includes("auth")) return { x: 72, y: 30 };
  if (path.includes("payment")) return { x: 82, y: 68 };
  return { x: 26, y: 52 };
}

function findClosestTopologyNode(point) {
  let winner = null;
  let smallestDistance = Number.POSITIVE_INFINITY;
  state.topologyNodes.forEach((node) => {
    const distance = Math.hypot(node.targetX - point.x, node.targetY - point.y);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      winner = node;
    }
  });
  return winner;
}

function kickTopologyNode(node, intensity = 1) {
  if (!node) return;
  node.velocityX += (Math.random() - 0.5) * 2.4 * intensity;
  node.velocityY += (Math.random() - 0.5) * 2.4 * intensity;
  node.pulseRadius = Math.max(node.pulseRadius, 6 * intensity);
  node.hotTimer = Math.max(node.hotTimer, Math.round(40 * intensity));
  node.isHot = true;
}

function setGlobalMousePosition(event) {
  document.documentElement.style.setProperty("--mouse-x", `${event.clientX}px`);
  document.documentElement.style.setProperty("--mouse-y", `${event.clientY}px`);

  const x = (event.clientX - window.innerWidth / 2) * 0.05;
  const y = (event.clientY - window.innerHeight / 2) * 0.05;

  document.documentElement.style.setProperty("--orb-x", `${x}px`);
  document.documentElement.style.setProperty("--orb-y", `${y}px`);

  window.clearTimeout(state.orbIdleTimeout);
  state.orbIdleTimeout = window.setTimeout(() => {
    document.documentElement.style.setProperty("--orb-x", "0px");
    document.documentElement.style.setProperty("--orb-y", "0px");
  }, 1500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function initializeStaggeredLoad() {
  document.querySelectorAll(".reveal-card").forEach((card, index) => {
    card.style.animationDelay = `${index * 100}ms`;
  });
}

function initializeCardPhysics() {
  const cards = document.querySelectorAll(".liquid-glass-wrapper");

  cards.forEach((wrapper) => {
    if (wrapper.dataset.physicsBound === "true") return;

    const card = wrapper.querySelector(".liquid-glass");
    if (!card) return;

    wrapper.dataset.physicsBound = "true";
    card.style.transformOrigin = "center center";
    card.style.transition = "transform 0.2s ease-out, filter 0.25s ease-out, background 0.25s ease-out, border-color 0.25s ease-out";

    wrapper.addEventListener("mousemove", (event) => {
      if (state.activeDrag?.wrapper === wrapper) return;

      const rect = card.getBoundingClientRect();
      const relativeX = event.clientX - rect.left;
      const relativeY = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateY = clamp(((relativeX - centerX) / centerX) * 4, -4, 4);
      const rotateX = clamp(((centerY - relativeY) / centerY) * 4, -4, 4);

      card.style.setProperty("--card-mouse-x", `${relativeX}px`);
      card.style.setProperty("--card-mouse-y", `${relativeY}px`);
      card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      card.style.transition = "transform 0.12s ease-out, filter 0.25s ease-out, background 0.25s ease-out, border-color 0.25s ease-out";
      wrapper.classList.add("is-hovered");
    });

    wrapper.addEventListener("mouseenter", () => {
      wrapper.classList.add("is-hovered");
    });

    wrapper.addEventListener("mouseleave", () => {
      if (state.activeDrag?.wrapper === wrapper) return;
      wrapper.classList.remove("is-hovered");
      card.style.transform = "rotateX(0deg) rotateY(0deg)";
      card.style.transition = "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.25s ease-out, background 0.25s ease-out, border-color 0.25s ease-out";
      card.style.setProperty("--card-mouse-x", "50%");
      card.style.setProperty("--card-mouse-y", "50%");
    });

    wrapper.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      state.activeDrag = {
        wrapper,
        card,
        startX: event.clientX,
        startY: event.clientY,
        rect: card.getBoundingClientRect()
      };
      wrapper.classList.add("is-hovered");
      card.style.transition = "transform 0.08s ease-out, filter 0.25s ease-out, background 0.25s ease-out, border-color 0.25s ease-out";
    });
  });

  if (state.cardPhysicsGlobalBound) return;
  state.cardPhysicsGlobalBound = true;

  window.addEventListener("mousemove", (event) => {
    if (!state.activeDrag) return;

    const { card, rect } = state.activeDrag;
    const deltaX = event.clientX - state.activeDrag.startX;
    const deltaY = event.clientY - state.activeDrag.startY;
    const translateX = clamp(deltaX * 0.14, -18, 18);
    const translateY = clamp(deltaY * 0.14, -18, 18);
    const rotateY = clamp(deltaX / 16, -5, 5);
    const rotateX = clamp(-deltaY / 16, -5, 5);
    const relativeX = clamp(event.clientX - rect.left, 0, rect.width);
    const relativeY = clamp(event.clientY - rect.top, 0, rect.height);

    card.style.setProperty("--card-mouse-x", `${relativeX}px`);
    card.style.setProperty("--card-mouse-y", `${relativeY}px`);
    card.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.01)`;
  });

  window.addEventListener("mouseup", () => {
    if (!state.activeDrag) return;
    state.activeDrag.wrapper.classList.remove("is-hovered");
    state.activeDrag.card.style.transform = "translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg)";
    state.activeDrag.card.style.transition = "transform 0.7s cubic-bezier(0.22, 1.4, 0.36, 1), filter 0.25s ease-out, background 0.25s ease-out, border-color 0.25s ease-out";
    state.activeDrag = null;
  });

  document.addEventListener("mouseleave", (event) => {
    const grid = document.getElementById("dashboard-grid");
    if (!grid || event.target !== grid) return;
    grid.querySelectorAll(".liquid-glass-wrapper").forEach((wrapper) => wrapper.classList.remove("is-hovered"));
  }, true);
}

function initializeGlassRipples() {
  if (state.ripplesBound) return;
  state.ripplesBound = true;

  window.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("#command-palette")) return;

    const ripple = document.createElement("span");
    ripple.className = "glass-ripple";
    ripple.style.left = `${event.clientX}px`;
    ripple.style.top = `${event.clientY}px`;
    ripple.style.width = "100px";
    ripple.style.height = "100px";
    document.body.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 800);
  });
}

function animateValue(element, target, duration = 1500, decimals = 0, suffix = "") {
  const start = Number(element.dataset.currentValue || "0");
  const delta = target - start;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = start + delta * eased;
    element.textContent = `${value.toFixed(decimals)}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.dataset.currentValue = String(target);
      element.textContent = `${target.toFixed(decimals)}${suffix}`;
    }
  }

  requestAnimationFrame(tick);
}

function animateMetricText(element, target, { duration = 300, decimals = 0, suffix = "", prefix = "" } = {}) {
  if (!element) return;
  const start = Number(element.dataset.currentValue || "0");
  const delta = target - start;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const jitter = progress < 1 ? (Math.random() - 0.5) * Math.max(Math.abs(delta) * 0.12, 0.4) : 0;
    const value = start + delta * progress + jitter;
    element.textContent = `${prefix}${value.toFixed(decimals)}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }

    element.dataset.currentValue = String(target);
    element.textContent = `${prefix}${target.toFixed(decimals)}${suffix}`;
  }

  requestAnimationFrame(tick);
}

function initializeRollingNumbers() {
  document.querySelectorAll("[data-roll-target]").forEach((element) => {
    const target = Number(element.dataset.rollTarget || "0");
    const decimals = Number(element.dataset.rollDecimals || "0");
    const suffix = element.dataset.rollSuffix || "";
    animateValue(element, target, 1500, decimals, suffix);
  });
}

function renderDashboardView() {
  return `
    <section class="reveal-card">
      <header class="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div class="space-y-4">
          <p class="text-[11px] uppercase tracking-[0.38em] text-cyan-200/80">Autonomous Reliability Surface</p>
          <div>
            <h1 class="text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl lg:text-7xl">Strata</h1>
            <p class="mt-3 max-w-2xl text-sm leading-7 text-[#c0cbf7]/75 sm:text-base">
              A liquid-glass command deck for live incident pressure, adaptive response lanes, and tactile observability physics.
            </p>
          </div>
        </div>
        <div class="flex flex-col items-stretch gap-3 lg:min-w-[420px]">
          <input
            id="global-filter-input"
            class="liquid-glass rounded-full px-5 py-3 text-sm text-white outline-none placeholder:text-white/35"
            type="text"
            placeholder="Global filter: payments, gateway, auth..."
            value="${state.globalFilter}"
          />
          <div class="flex flex-col items-stretch gap-3 sm:flex-row">
          <button id="command-trigger" class="liquid-glass rounded-full px-5 py-3 text-sm text-white/80 transition hover:text-white" type="button">
            Open Command Palette
            <span class="ml-2 rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">Cmd + K</span>
          </button>
          <button id="fix-button" class="action-morph-button" type="button">
            <span class="action-text">Fix This for Me</span>
            <span class="action-icon" aria-hidden="true">✓</span>
          </button>
          </div>
        </div>
      </header>

      <section class="mb-6 liquid-glass-wrapper reveal-card">
        <div class="liquid-glass rounded-[28px] p-4 shadow-glass sm:p-5">
          <div class="layer-30 relative z-[2] flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Temporal Debugger</p>
              <h2 class="mt-1 text-xl font-semibold text-white">Incident Replay</h2>
            </div>
            <div class="flex flex-1 items-center gap-3">
              <span class="text-[10px] uppercase tracking-[0.25em] text-white/45">Live</span>
              <input id="replay-slider" class="replay-slider w-full" type="range" min="0" max="50" value="50" />
              <span id="replay-label" class="min-w-[140px] text-right text-[10px] uppercase tracking-[0.25em] text-white/55">Following live stream</span>
            </div>
          </div>
        </div>
      </section>

      <div id="dashboard-grid" class="dashboard-grid grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-6">
        <div class="liquid-glass-wrapper reveal-card lg:col-span-8" data-filter-tags="gateway auth payments incidents logs dashboard mesh">
          <section class="liquid-glass relative overflow-hidden rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <div class="mb-8 flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div class="max-w-2xl">
                  <div class="mb-4 flex items-center gap-3">
                    <span class="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-cyan-100">Live Reliability Mesh</span>
                    <span class="text-xs text-white/45">Streaming from your in-memory incident engine</span>
                  </div>
                  <h2 class="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">Fluid incident intelligence with physical depth.</h2>
                  <p class="mt-3 max-w-xl text-sm leading-7 text-[#c0cbf7]/70">
                    Pressure ripples, service hotspots, and response posture are rendered as tactile glass surfaces that react to cursor proximity and live API changes.
                  </p>
                </div>
                <div class="grid grid-cols-2 gap-3 sm:gap-4">
                  <div class="metric-pod" data-filter-tags="gateway auth payments pressure"><p class="metric-label">Critical Load</p><p id="critical-load-value" class="metric-value font-headline tabular-nums tracking-[-0.05em]">0%</p></div>
                  <div id="latency-pod" class="metric-pod" data-filter-tags="gateway auth payments latency">
                    <p class="metric-label">Mean Latency</p>
                    <div id="latency-pod-content"><p class="metric-value font-headline tabular-nums tracking-[-0.05em]" data-roll-target="92" data-roll-suffix="ms">0ms</p></div>
                  </div>
                  <div class="metric-pod" data-filter-tags="automation auth gateway payments"><p class="metric-label">Automation</p><p id="automation-value" class="metric-value font-headline tabular-nums tracking-[-0.05em]">0%</p></div>
                  <div class="metric-pod" data-filter-tags="watchers incidents mesh"><p class="metric-label">Active Watchers</p><p id="watchers-value" class="metric-value font-headline tabular-nums tracking-[-0.05em]">0</p></div>
                </div>
              </div>

              <div class="grid gap-4 lg:grid-cols-[1.35fr,0.85fr]">
                <div class="liquid-glass rounded-[28px] p-4 sm:p-5">
                  <div class="mb-4 flex items-center justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Pressure Timeline</p>
                      <h3 class="mt-1 text-lg font-semibold text-white">System Load Vector</h3>
                    </div>
                    <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">12 min window</span>
                  </div>
                  <div id="load-chart" class="chart-shell h-64 rounded-[24px]">
                    <svg viewBox="0 0 700 280" class="h-full w-full" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="chartStroke" x1="0%" x2="100%" y1="0%" y2="0%">
                          <stop offset="0%" stop-color="#00f2fe"></stop>
                          <stop offset="100%" stop-color="#7e51ff"></stop>
                        </linearGradient>
                        <linearGradient id="chartFill" x1="0%" x2="0%" y1="0%" y2="100%">
                          <stop offset="0%" stop-color="rgba(0, 242, 254, 0.35)"></stop>
                          <stop offset="100%" stop-color="rgba(126, 81, 255, 0)"></stop>
                        </linearGradient>
                      </defs>
                      <path id="chart-area" fill="url(#chartFill)" opacity="0.45"></path>
                      <path id="chart-line" fill="none" stroke="url(#chartStroke)" stroke-width="4" stroke-linecap="round"></path>
                      <g id="chart-points"></g>
                      <line id="chart-scrubber-line" class="opacity-0" y1="18" y2="250"></line>
                    </svg>
                    <div id="chart-tooltip" class="chart-tooltip opacity-0">
                      <p id="chart-tooltip-label" class="text-[11px] uppercase tracking-[0.3em] text-cyan-200/70"></p>
                      <p id="chart-tooltip-value" class="mt-1 text-lg font-semibold text-white"></p>
                    </div>
                    <div id="chart-overlay" class="absolute inset-0"></div>
                  </div>
                </div>

                <div class="flex flex-col gap-4">
                  <div class="liquid-glass rounded-[28px] p-4 sm:p-5">
                    <p class="text-xs uppercase tracking-[0.3em] text-white/45">Neural Response</p>
                    <p class="mt-2 text-3xl font-semibold tracking-[-0.05em] text-white" id="top-severity-readout">Critical</p>
                    <p class="mt-3 text-sm leading-7 text-[#c0cbf7]/70" id="top-severity-summary">Waiting for the live incident stream to declare the dominant failure pattern.</p>
                  </div>
                  <div class="liquid-glass rounded-[28px] p-4 sm:p-5">
                    <div class="flex items-center justify-between">
                      <div>
                        <p class="text-xs uppercase tracking-[0.3em] text-white/45">Rapid Controls</p>
                        <h3 class="mt-1 text-lg font-semibold text-white">Stream Operations</h3>
                      </div>
                      <button id="clear-logs-button" class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white" type="button">Clear Logs</button>
                    </div>
                    <div class="mt-5 flex flex-wrap gap-3">
                      <button class="liquid-chip" type="button">Contain Gateway</button>
                      <button class="liquid-chip" type="button">Throttle Auth</button>
                      <button class="liquid-chip" type="button">Warm Payments</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-4" data-filter-tags="auth gateway payments command pulse">
          <section class="liquid-glass rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6 flex items-center justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Command Posture</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Operational Pulse</h2>
                </div>
                <span id="incident-count" class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">0 incidents</span>
              </div>
              <div class="space-y-4">
                <div class="pulse-row"><span>Escalation Pressure</span><span class="text-cyan-100" id="pulse-pressure">Nominal</span></div>
                <div class="pulse-row"><span>Dominant Service</span><span class="text-white" id="pulse-service">Awaiting data</span></div>
                <div class="pulse-row"><span>Inference Drift</span><span class="text-[#ffcad5]">2.1%</span></div>
              </div>
              <div class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div class="mini-surface"><p class="mini-label">Remediation Confidence</p><p class="mini-value font-headline tabular-nums tracking-[-0.05em]" data-roll-target="86" data-roll-suffix="%">0%</p></div>
                <div class="mini-surface"><p class="mini-label">Pipeline Sync</p><p class="mini-value font-headline tabular-nums tracking-[-0.05em]" data-roll-target="31" data-roll-suffix="s">0s</p></div>
              </div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card md:col-span-1 lg:col-span-3" data-filter-tags="gateway">
          <section class="liquid-glass rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Gateway Band</p>
              <h3 class="mt-2 text-xl font-semibold text-white">Ingress Shear</h3>
              <p class="mt-3 text-sm leading-7 text-[#c0cbf7]/70">Route stability is refracting traffic pressure across the front door.</p>
              <div class="mt-6 h-2 overflow-hidden rounded-full bg-white/5"><div class="h-full w-[67%] rounded-full bg-gradient-to-r from-cyan-300/90 to-fuchsia-300/90"></div></div>
              <p class="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white font-headline tabular-nums" data-roll-target="67" data-roll-suffix="%">0%</p>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card md:col-span-1 lg:col-span-3" data-filter-tags="payments">
          <section class="liquid-glass rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Payment Mesh</p>
              <h3 class="mt-2 text-xl font-semibold text-white">Settlement Elasticity</h3>
              <p class="mt-3 text-sm leading-7 text-[#c0cbf7]/70">Retry turbulence is still visible, but the lane is elastic and recoverable.</p>
              <div class="mt-6 h-2 overflow-hidden rounded-full bg-white/5"><div class="h-full w-[81%] rounded-full bg-gradient-to-r from-emerald-300/90 to-cyan-300/90"></div></div>
              <p class="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white font-headline tabular-nums" data-roll-target="81" data-roll-suffix="%">0%</p>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card md:col-span-2 lg:col-span-6" data-filter-tags="incidents auth gateway payments">
          <section class="liquid-glass rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <div class="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Live Incident Field</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Incident Refractions</h2>
                </div>
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">Auto-refreshing</span>
              </div>
              <div id="incident-list" class="space-y-3"></div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card md:col-span-1 lg:col-span-4" data-filter-tags="gateway auth payments topology">
          <section class="liquid-glass rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <div class="mb-5 flex items-center justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Threat Topology Map</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Epicenter Visualization</h2>
                </div>
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">Live mesh</span>
              </div>
              <div id="topology-shell" class="relative w-full h-64 md:h-[400px] rounded-2xl overflow-hidden bg-[#040814] border border-white/5 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)]">
                <canvas id="topology-canvas" class="absolute inset-0 w-full h-full"></canvas>
                <div class="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_20%,#040814_120%)]"></div>
                <div class="absolute left-4 top-4 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-cyan-200/60">Gateway / Auth / Payments</div>
              </div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card md:col-span-1 lg:col-span-8" data-filter-tags="logs gateway auth payments">
          <section class="liquid-glass rounded-[32px] p-4 shadow-glass sm:p-6 lg:p-8">
            <div class="layer-30 relative z-[2]">
              <div class="mb-5 flex items-center justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Telemetry Stream</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Recent Log Reflections</h2>
                </div>
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">Live sample</span>
              </div>
              <div id="log-list" class="space-y-3"></div>
            </div>
          </section>
        </div>
      </div>

      <section class="mt-6">
        <div class="bottom-kpis flex gap-4 overflow-x-auto pb-2">
          <div class="liquid-glass-wrapper min-w-[220px] flex-1 reveal-card"><div id="cohort-sync-pod" class="metric-pod reactive-metric-pod rounded-[28px] p-4 shadow-glass sm:p-5"><div class="layer-30 relative z-[2]"><p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Node Availability</p><p id="cohort-sync-value" class="mt-2 text-3xl font-semibold text-white font-headline tabular-nums tracking-[-0.05em]">0/12</p></div></div></div>
          <div class="liquid-glass-wrapper min-w-[220px] flex-1 reveal-card"><div id="root-cause-pod" class="metric-pod reactive-metric-pod rounded-[28px] p-4 shadow-glass sm:p-5"><div class="layer-30 relative z-[2]"><p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Root Cause Span</p><p id="root-cause-value" class="metric-swap-target mt-2 text-3xl font-semibold text-white font-headline tabular-nums tracking-[-0.05em]">0m</p><svg class="root-cause-sparkline" viewBox="0 0 180 56" preserveAspectRatio="none" aria-hidden="true"><path id="root-cause-sparkline-path"></path></svg></div></div></div>
          <div class="liquid-glass-wrapper min-w-[220px] flex-1 reveal-card"><div id="runtime-stability-pod" class="metric-pod reactive-metric-pod rounded-[28px] p-4 shadow-glass sm:p-5"><div class="layer-30 relative z-[2]"><p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">SLA Tracker</p><p id="runtime-stability-value" class="mt-2 text-3xl font-semibold text-white font-headline tabular-nums tracking-[-0.05em]">0%</p></div></div></div>
          <div class="liquid-glass-wrapper min-w-[220px] flex-1 reveal-card"><div id="memory-drift-pod" class="metric-pod reactive-metric-pod rounded-[28px] p-4 shadow-glass sm:p-5"><div class="layer-30 relative z-[2]"><p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">JVM/Heap Pressure</p><p id="memory-drift-value" class="mt-2 text-3xl font-semibold text-white font-headline tabular-nums tracking-[-0.05em]">0GB</p><p id="memory-drift-warning" class="mt-2 text-[10px] uppercase tracking-[0.25em] text-white/45">Memory within threshold</p></div></div></div>
        </div>
      </section>
    </section>
  `;
}

function renderClusterView() {
  const clusterNodes = Array.from({ length: 12 }, (_, index) => `
    <div id="deploy-node-${index}" class="cluster-node liquid-glass rounded-[18px] min-h-[120px] p-3 flex flex-col justify-between">
      <span class="text-[10px] uppercase tracking-[0.22em] text-white/45">${["gateway-svc", "auth-svc", "payments-svc"][index % 3]}-${7 + index}x${2 + (index % 4)}</span>
      <span class="deploy-node-service text-sm font-medium text-white/80">idle</span>
      <span class="deploy-node-cpu text-[11px] uppercase tracking-[0.2em] text-white/55">CPU: 0%</span>
      <span class="deploy-node-status text-[10px] uppercase tracking-[0.22em] text-cyan-100/70">Status: Ready</span>
    </div>
  `).join("");

  return `
    <section class="reveal-card">
      <header class="mb-8">
        <p class="text-[11px] uppercase tracking-[0.38em] text-cyan-200/80">Kubernetes Control Plane</p>
        <div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 class="text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl lg:text-7xl">Cluster</h1>
            <p class="mt-3 max-w-2xl text-sm leading-7 text-[#c0cbf7]/75">Pod health, replica behavior, and canary rollout visibility.</p>
          </div>
          <button id="command-trigger" class="liquid-glass rounded-full px-5 py-3 text-sm text-white/80 transition hover:text-white" type="button">
            Open Command Palette
            <span class="ml-2 rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">Cmd + K</span>
          </button>
        </div>
      </header>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div class="liquid-glass-wrapper reveal-card lg:col-span-3">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Resource Pressure</p>
              <h2 class="mt-1 text-2xl font-semibold text-white">Control Plane Load</h2>
              <div class="mt-6 space-y-5">
                <div>
                  <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-white/45"><span>CPU</span><span id="cluster-load-readout">0%</span></div>
                  <div class="pressure-bar mt-3"><span id="resource-cpu-bar" style="width:0%"></span></div>
                </div>
                <div>
                  <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-white/45"><span>Memory</span><span id="cluster-memory-readout">0%</span></div>
                  <div class="pressure-bar mt-3"><span id="resource-memory-bar" class="amber"></span></div>
                  <p id="cluster-memory-detail" class="mt-3 text-xs uppercase tracking-[0.2em] text-white/45">0 MB heap used</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-6">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6">
                <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Pod Health Map</p>
                <h2 class="mt-1 text-2xl font-semibold text-white">K8s Pod Grid</h2>
              </div>
              <div id="deployment-node-grid" class="grid grid-cols-2 gap-3 sm:grid-cols-3">${clusterNodes}</div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-3">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Node Distribution</p>
              <h2 class="mt-1 text-2xl font-semibold text-white">Placement</h2>
              <div class="mt-6 space-y-3">
                <div class="mini-surface"><p class="mini-label">Node-A</p><p id="node-a-count" class="mini-value">0</p></div>
                <div class="mini-surface"><p class="mini-label">Node-B</p><p id="node-b-count" class="mini-value">0</p></div>
              </div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-12">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Pipeline River</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Live Pipeline</h2>
                </div>
                <button id="deploy-canary-button" class="action-morph-button" type="button">
                  <span class="action-text">Start Canary Deployment</span>
                  <span class="action-icon" aria-hidden="true">✓</span>
                </button>
              </div>
              <div class="deployment-pipeline relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <svg class="pipeline-flow-line" viewBox="0 0 1000 120" preserveAspectRatio="none">
                  <path d="M 40 60 C 220 60, 220 60, 400 60 S 580 60, 760 60 S 860 60, 960 60"></path>
                </svg>
                <div class="pipeline-step-wrapper"><div class="pipeline-step liquid-glass">Build</div></div>
                <div class="pipeline-step-wrapper"><div class="pipeline-step liquid-glass">Test</div></div>
                <div class="pipeline-step-wrapper"><div class="pipeline-step liquid-glass">Image</div></div>
                <div class="pipeline-step-wrapper"><div class="pipeline-step liquid-glass">Deploy</div></div>
              </div>
              <div class="mt-6 h-3 overflow-hidden rounded-full border border-white/10 bg-white/5">
                <div id="deploy-canary-progress" class="h-full w-0 rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-emerald-400 transition-[width] duration-300"></div>
              </div>
              <p id="deploy-canary-status" class="mt-3 text-xs uppercase tracking-[0.25em] text-white/45">Canary idle: v1 receiving 100% traffic</p>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-5">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6">
                <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">CI/CD Telemetry</p>
                <h2 class="mt-1 text-2xl font-semibold text-white">Orchestration Echo</h2>
              </div>
              <div id="deployment-event-stream" class="pipeline-stepper"></div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-7">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6">
                <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Ingress Traffic</p>
                <h2 class="mt-1 text-2xl font-semibold text-white">Requests Per Second</h2>
              </div>
              <div id="traffic-equalizer" class="traffic-equalizer"></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderSecurityView() {
  return `
    <section class="reveal-card">
      <header class="mb-8">
        <p class="text-[11px] uppercase tracking-[0.38em] text-cyan-200/80">WAF Analytics</p>
        <div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 class="text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl lg:text-7xl">Security</h1>
            <p class="mt-3 max-w-2xl text-sm leading-7 text-[#c0cbf7]/75">Live request analytics, blocked client traffic, and path-scan visibility from the running platform.</p>
          </div>
          <button id="command-trigger" class="liquid-glass rounded-full px-5 py-3 text-sm text-white/80 transition hover:text-white" type="button">
            Open Command Palette
            <span class="ml-2 rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">Cmd + K</span>
          </button>
        </div>
      </header>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div class="liquid-glass-wrapper reveal-card lg:col-span-4">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6">
                <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">WAF Analytics</p>
                <h2 class="mt-1 text-2xl font-semibold text-white">Threat Feed</h2>
              </div>
              <div id="security-blocked-stream" class="security-terminal min-h-[420px]"></div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-4">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6">
                <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Most Requested Paths</p>
                <h2 class="mt-1 text-2xl font-semibold text-white">Top 5 Paths</h2>
              </div>
              <div id="security-top-paths" class="space-y-3"></div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-4">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Potential Scans</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Spike Summary</h2>
                </div>
              </div>
              <div class="rounded-[24px] border border-white/8 bg-black/20 p-4">
                <div class="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-rose-300 inline-flex">
                  <span id="security-threat-count">0</span>&nbsp;Potential Scans
                </div>
                <div id="security-scan-summary" class="mt-4 space-y-3"></div>
              </div>
            </div>
          </section>
        </div>

        <div class="liquid-glass-wrapper reveal-card lg:col-span-12">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Threat Stream</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">Search Terminal</h2>
                </div>
                <input id="logs-filter-input" class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none placeholder:text-white/30" type="text" placeholder="Filter logs by service, path, code, or message..." />
              </div>
              <div id="security-intrusion-stream" class="security-terminal"></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderUpgradeView() {
  return `
    <section class="reveal-card">
      <header class="mb-8">
        <p class="text-[11px] uppercase tracking-[0.38em] text-cyan-200/80">System Upgrade</p>
        <div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 class="text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl lg:text-7xl">Upgrade Center</h1>
            <p class="mt-3 max-w-2xl text-sm leading-7 text-[#c0cbf7]/75">Kernel refresh, glow remap, and rolling deployment orchestration.</p>
          </div>
          <button id="command-trigger" class="liquid-glass rounded-full px-5 py-3 text-sm text-white/80 transition hover:text-white" type="button">
            Open Command Palette
            <span class="ml-2 rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">Cmd + K</span>
          </button>
        </div>
      </header>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div class="liquid-glass-wrapper reveal-card lg:col-span-5">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Current Version</p>
              <h2 class="mt-2 text-3xl font-semibold text-white font-headline">v2.4.0-stable</h2>
              <p class="mt-6 text-xs uppercase tracking-[0.3em] text-cyan-200/70">Available Version</p>
              <h3 class="mt-2 text-2xl font-semibold text-white">v2.5.1-beta</h3>
              <div class="mt-6 rounded-[24px] border border-white/8 bg-black/20 p-4 font-headline text-sm leading-7 text-[#c0cbf7]/80">
                <div><span class="text-emerald-300">+ Added Kernel Parallax</span></div>
                <div><span class="text-emerald-300">+ Added Support Explorer</span></div>
                <div><span class="text-rose-300">- Fixed Canvas Ghosting</span></div>
              </div>
            </div>
          </section>
        </div>
        <div class="liquid-glass-wrapper reveal-card lg:col-span-7">
          <section class="liquid-glass rounded-[32px] p-5 shadow-glass sm:p-7">
            <div class="layer-30 relative z-[2]">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Deployment Initiator</p>
                  <h2 class="mt-1 text-2xl font-semibold text-white">System Re-Skin</h2>
                </div>
                <button id="upgrade-initiate-button" class="action-morph-button" type="button">
                  <span class="action-text">Initiate Deployment</span>
                  <span class="action-icon" aria-hidden="true">✓</span>
                </button>
              </div>
              <div class="mt-8 h-4 overflow-hidden rounded-full border border-white/10 bg-white/5">
                <div id="upgrade-progress-bar" class="h-full w-0 rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-emerald-300 transition-[width] duration-300"></div>
              </div>
              <p id="upgrade-status-text" class="mt-4 text-xs uppercase tracking-[0.25em] text-white/45">Awaiting deployment trigger</p>
              <div id="upgrade-version-label" class="mt-3 text-sm text-white/70">v1.0 stable -> v1.1 canary</div>
              <div id="upgrade-canary-grid" class="upgrade-canary-grid">${Array.from({ length: 10 }, (_, index) => `<div id="upgrade-canary-node-${index}" class="upgrade-canary-node"></div>`).join("")}</div>
              <div id="upgrade-terminal" class="security-terminal mt-6 min-h-[260px]"></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

const routes = {
  "#dashboard": renderDashboardView,
  "#cluster": renderClusterView,
  "#security": renderSecurityView,
  "#upgrade": renderUpgradeView
};

function syncRouteLinks(route) {
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    const isActive = link.getAttribute("href") === route;
    link.classList.toggle("nav-pill-active", isActive);
    link.classList.toggle("mobile-nav-pill-active", isActive);
  });
}

function initializeTopologyMap() {
  const canvas = document.getElementById("topology-canvas");
  if (!canvas) return;

  if (state.topologyRaf) {
    cancelAnimationFrame(state.topologyRaf);
    state.topologyRaf = null;
  }

  const ctx = canvas.getContext("2d");
  const shell = document.getElementById("topology-shell");
  if (!ctx) return;
  canvas.style.pointerEvents = "none";

  state.topologyNodes = [
    new ServiceNode({ id: "gateway", x: 20, y: 50, color: "#00f2fe", label: "Gateway" }),
    new ServiceNode({ id: "auth", x: 70, y: 30, color: "#a68cff", label: "Auth" }),
    new ServiceNode({ id: "payments", x: 80, y: 70, color: "#10b981", label: "Payments" })
  ];
  state.canvasState.topologyNodes = state.topologyNodes;
  state.topologyEdges = [["gateway", "auth"], ["gateway", "payments"]];

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function getPosition(node) {
    return {
      x: (node.x / 100) * canvas.clientWidth,
      y: (node.y / 100) * canvas.clientHeight
    };
  }

  function frame() {
    if (!canvas.isConnected || state.currentRoute !== "#dashboard") return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "screen";

    state.topologyNodes.forEach((node) => {
      const springX = (node.targetX - node.x) * 0.05;
      const springY = (node.targetY - node.y) * 0.05;
      node.velocityX = (node.velocityX + springX) * 0.8;
      node.velocityY = (node.velocityY + springY) * 0.8;
      node.x += node.velocityX;
      node.y += node.velocityY;
      node.pulseRadius += (0 - node.pulseRadius) * 0.12;
      if (node.hotTimer > 0) {
        node.hotTimer -= 1;
        node.isHot = true;
      } else {
        node.isHot = false;
      }
    });

    state.topologyEdges.forEach(([fromId, toId]) => {
      const from = state.topologyNodes.find((node) => node.id === fromId);
      const to = state.topologyNodes.find((node) => node.id === toId);
      if (!from || !to) return;
      const a = getPosition(from);
      const b = getPosition(to);
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    state.topologyNodes.forEach((node) => {
      const pos = getPosition(node);
      const color = node.isHot ? "#fb7185" : node.color;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.shadowBlur = node.isHot ? 30 : 15;
      ctx.shadowColor = color;
      ctx.arc(pos.x, pos.y, node.radius + node.pulseRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = '10px "Inter", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(node.label.toUpperCase(), pos.x, pos.y + 22);
      if (node.isHot) {
        ctx.fillStyle = "rgba(251, 113, 133, 0.95)";
        ctx.font = '9px "Inter", sans-serif';
        ctx.fillText(`Pod: ${node.statusLabel}`, pos.x, pos.y - 14);
      }
    });

    state.topologyRaf = requestAnimationFrame(frame);
  }

  resizeCanvas();
  shell?.addEventListener("mouseenter", () => {
    canvas.style.pointerEvents = "auto";
  });
  shell?.addEventListener("mousemove", (event) => {
    const rect = shell.getBoundingClientRect();
    state.topologyMouse.x = ((event.clientX - rect.left) / rect.width) * 100;
    state.topologyMouse.y = ((event.clientY - rect.top) / rect.height) * 100;
  });
  shell?.addEventListener("mouseleave", () => {
    canvas.style.pointerEvents = "none";
    state.topologyMouse.x = -9999;
    state.topologyMouse.y = -9999;
  });
  shell?.addEventListener("click", (event) => {
    const rect = shell.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const hit = state.topologyNodes.find((node) => {
      const pos = getPosition(node);
      return Math.hypot(pos.x - clickX, pos.y - clickY) <= 20;
    });
    if (!hit) return;
    state.selectedTopologyService = hit.id;
    renderTopologyTerminal(getActiveSnapshot().logs);
  });
  window.addEventListener("resize", resizeCanvas, { once: true });
  state.topologyRaf = requestAnimationFrame(frame);
}

function initializeSecurityTopologyMap() {
  const canvas = document.getElementById("security-topology-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const nodes = state.canvasState.topologyNodes || state.topologyNodes;

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    if (!canvas.isConnected || state.currentRoute !== "#security") return;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.globalCompositeOperation = "screen";
    const positions = nodes.map((node) => ({
      ...node,
      px: (node.x / 100) * canvas.clientWidth,
      py: (node.y / 100) * canvas.clientHeight
    }));
    [["gateway", "auth"], ["gateway", "payments"]].forEach(([aId, bId]) => {
      const a = positions.find((item) => item.id === aId);
      const b = positions.find((item) => item.id === bId);
      if (!a || !b) return;
      ctx.beginPath();
      const critical = a.isHot || b.isHot;
      ctx.strokeStyle = critical ? "rgba(251,113,133,0.6)" : "rgba(255,255,255,0.1)";
      ctx.moveTo(a.px, a.py);
      if (critical) {
        const midX = (a.px + b.px) / 2;
        const midY = (a.py + b.py) / 2 + Math.sin(performance.now() / 120) * 8;
        ctx.lineTo(midX, midY);
      }
      ctx.lineTo(b.px, b.py);
      ctx.stroke();
    });
    positions.forEach((node) => {
      ctx.beginPath();
      ctx.fillStyle = node.isHot ? "#fb7185" : node.color;
      ctx.shadowBlur = node.isHot ? 26 : 14;
      ctx.shadowColor = node.isHot ? "#fb7185" : node.color;
      ctx.arc(node.px, node.py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = '10px "Inter", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(node.id.toUpperCase(), node.px, node.py + 22);
    });
    requestAnimationFrame(draw);
  }

  resizeCanvas();
  requestAnimationFrame(draw);
}

function initializeChartScrubber() {
  const overlay = document.getElementById("chart-overlay");
  if (!overlay || overlay.dataset.bound === "true") return;
  overlay.dataset.bound = "true";

  overlay.addEventListener("mousemove", (event) => {
    const chartScrubberLine = document.getElementById("chart-scrubber-line");
    const chartTooltip = document.getElementById("chart-tooltip");
    const chartTooltipLabel = document.getElementById("chart-tooltip-label");
    const chartTooltipValue = document.getElementById("chart-tooltip-value");
    const rect = overlay.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = clamp(x / rect.width, 0, 1);
    const index = clamp(Math.round(ratio * (state.chartSeries.length - 1)), 0, state.chartSeries.length - 1);
    const point = state.chartSeries[index];
    const lineX = 26 + ((700 - 52) / Math.max(state.chartSeries.length - 1, 1)) * index;

    if (!point || !chartScrubberLine || !chartTooltip || !chartTooltipLabel || !chartTooltipValue) return;

    chartScrubberLine.setAttribute("x1", lineX);
    chartScrubberLine.setAttribute("x2", lineX);
    chartScrubberLine.classList.remove("opacity-0");
    chartTooltip.classList.remove("opacity-0");
    chartTooltip.style.left = `${clamp(x + 18, 16, rect.width - 176)}px`;
    chartTooltip.style.top = "16px";
    chartTooltipLabel.textContent = point.label;
    chartTooltipValue.textContent = `${point.value}% load`;
  });

  overlay.addEventListener("mouseleave", () => {
    document.getElementById("chart-scrubber-line")?.classList.add("opacity-0");
    document.getElementById("chart-tooltip")?.classList.add("opacity-0");
  });
}

function buildChartSeries(logs) {
  const recentLogs = [...logs].sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp)).slice(-20);
  if (recentLogs.length === 0) return [];

  const bucketWindowMs = 2_000;
  const startMs = Math.floor(parseTimestamp(recentLogs[0].timestamp) / bucketWindowMs) * bucketWindowMs;
  const endMs = parseTimestamp(recentLogs[recentLogs.length - 1].timestamp);
  const bucketCount = Math.max(5, Math.min(10, Math.floor((endMs - startMs) / bucketWindowMs) + 1));
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    startMs: startMs + index * bucketWindowMs,
    errors: 0,
    warns: 0,
    total: 0
  }));

  recentLogs.forEach((log) => {
    const bucketIndex = clamp(Math.floor((parseTimestamp(log.timestamp) - startMs) / bucketWindowMs), 0, buckets.length - 1);
    const bucket = buckets[bucketIndex];
    bucket.total += 1;
    if (log.level === "error") bucket.errors += 1;
    if (log.level === "warn") bucket.warns += 1;
  });

  return buckets.map((bucket) => {
    const weightedDensity = bucket.total === 0 ? 0 : ((bucket.errors + bucket.warns * 0.6) / bucket.total) * 100;
    const activityLift = Math.min(bucket.total * 8, 24);
    return {
      label: new Date(bucket.startMs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      value: Math.min(100, weightedDensity + activityLift),
      service: "mesh"
    };
  });
}

function renderChart(series) {
  const chartLine = document.getElementById("chart-line");
  const chartArea = document.getElementById("chart-area");
  const chartPoints = document.getElementById("chart-points");
  if (!chartLine || !chartArea || !chartPoints) return;

  const chartInput = state.incidentMode === "critical" && !isReplaying
    ? Array.from({ length: Math.max(series.length, 8) }, (_, index) => ({ label: `critical-${index + 1}`, value: 100, service: "mesh" }))
    : series;

  state.chartSeries = chartInput.length > 0
    ? chartInput
    : [
        { label: "idle-1", value: 24, service: "mesh" },
        { label: "idle-2", value: 28, service: "mesh" },
        { label: "idle-3", value: 22, service: "mesh" },
        { label: "idle-4", value: 26, service: "mesh" }
      ];

  const width = 700;
  const paddingX = 26;
  const minY = 18;
  const maxY = 250;
  const step = state.chartSeries.length > 1 ? (width - paddingX * 2) / (state.chartSeries.length - 1) : 0;

  const points = state.chartSeries.map((item, index) => {
    const x = paddingX + index * step;
    const y = maxY - (item.value / 100) * (maxY - minY);
    return { ...item, x, y };
  });

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${maxY} L ${points[0].x.toFixed(2)} ${maxY} Z`;
  chartLine.setAttribute("d", linePath);
  chartArea.setAttribute("d", areaPath);
  chartPoints.innerHTML = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="rgba(255,255,255,0.9)" opacity="0.9"></circle>`).join("");
}

function simulateCriticalSpike() {
  state.incidentMode = "critical";
  state.remediationTimers.forEach((timer) => clearTimeout(timer));
  state.remediationTimers = [];
  setPrimaryGlow("#fb7185");
  document.body.classList.add("emergency-pulse");
  writeOpsLine("[CRITICAL] Gateway saturation event injected");
  writeOpsLine("[CRITICAL] Payment retries exhausted");
  writeOpsLine("[CRITICAL] Auth signer queue breached");
  syncCurrentTelemetry();
  if (!isReplaying) renderLiveSnapshot();
}

function getServiceSurface(label) {
  return [...document.querySelectorAll(".liquid-glass h3")].find((heading) => heading.textContent.trim() === label)?.closest(".liquid-glass");
}

function ensureServiceSparkline(service, headingText) {
  const existing = getServiceSurface(headingText)?.querySelector(".service-sparkline-shell");
  if (existing) {
    return {
      mount: existing,
      score: existing.querySelector(".service-sparkline-score"),
      path: existing.querySelector(".service-sparkline-path")
    };
  }

  const surface = getServiceSurface(headingText);
  if (!surface) return null;

  const mount = document.createElement("div");
  mount.className = "service-sparkline-shell";
  mount.innerHTML = `
    <div class="service-sparkline-meta">
      <span>${service} flux</span>
      <span class="service-sparkline-score">stable</span>
    </div>
    <svg class="service-sparkline" viewBox="0 0 180 48" preserveAspectRatio="none" aria-hidden="true">
      <path class="service-sparkline-path"></path>
    </svg>
  `;
  surface.querySelector(".layer-30").appendChild(mount);
  return {
    mount,
    score: mount.querySelector(".service-sparkline-score"),
    path: mount.querySelector(".service-sparkline-path")
  };
}

function buildServiceSparklineSeries(logs, service) {
  const serviceLogs = [...logs].filter((log) => log.service === service).sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp)).slice(-10);
  if (serviceLogs.length === 0) return [16, 18, 14, 20, 17];

  const bins = Array.from({ length: 5 }, () => []);
  serviceLogs.forEach((log, index) => {
    const bucketIndex = Math.min(4, Math.floor((index / Math.max(serviceLogs.length, 1)) * 5));
    bins[bucketIndex].push(log);
  });

  return bins.map((bin) => {
    if (bin.length === 0) return 14;
    const weighted = bin.reduce((score, log) => {
      if (log.level === "error") return score + 88;
      if (log.level === "warn") return score + 58;
      return score + 24;
    }, 0);
    return Math.round(weighted / bin.length);
  });
}

function buildSparklinePath(values, width = 180, height = 48) {
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = index * step;
    const y = height - (value / 100) * (height - 6) - 3;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function updateServiceSparkline(service, headingText, logs) {
  const entry = ensureServiceSparkline(service, headingText);
  if (!entry) return;
  const series = buildServiceSparklineSeries(logs, service);
  entry.path.setAttribute("d", buildSparklinePath(series));
  const recentServiceLog = [...logs].find((log) => log.service === service);
  const isHot = Boolean(recentServiceLog && recentServiceLog.level === "error" && Date.now() - parseTimestamp(recentServiceLog.timestamp) < 10_000);
  entry.mount.classList.toggle("is-hot", isHot);
  entry.score.textContent = `${series[series.length - 1]} load`;
}

function updateAmbientAnxiety(incidents, logs) {
  const hasCriticalLog = logs.some((log) => log.errorCode === "CRITICAL_ERROR");
  const nextDuration = incidents.length > 0 || hasCriticalLog ? "1.5s" : "4s";
  ambientAnxiety?.style.setProperty("--anxiety-duration", nextDuration);
  document.documentElement.style.setProperty("--anxiety-duration", nextDuration);
}

function buildLatencySeries(logs) {
  const latest = [...logs]
    .filter((log) => typeof log.latencyMs === "number")
    .sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp))
    .slice(-8);

  if (latest.length === 0) return [92, 88, 96, 90, 94, 91];
  return latest.map((log) => clamp(log.latencyMs, 20, 240));
}

function buildLatencySparkPath(values, width = 220, height = 72) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;

  return values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * (height - 12) - 6;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function buildMetricSparklinePath(values, width = 180, height = 56) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;

  return values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * (height - 12) - 6;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function renderLatencyPod(snapshot) {
  const mount = document.getElementById("latency-pod-content");
  if (!mount) return;
  const logs = snapshot.logs || [];
  const displayLatency = Number.isFinite(snapshot.latency)
    ? snapshot.latency
    : ([...logs].find((log) => typeof log.latencyMs === "number")?.latencyMs ?? 92);

  if (!state.latencyDetailedView) {
    mount.innerHTML = `<p class="metric-value font-headline tabular-nums tracking-[-0.05em]" data-roll-target="${displayLatency}" data-roll-suffix="ms">0ms</p>`;
    initializeRollingNumbers();
    return;
  }

  const values = buildLatencySeries(logs);
  values[values.length - 1] = clamp(displayLatency, 20, 240);
  mount.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="metric-label">Detailed View</span>
        <span class="text-sm font-headline tracking-[-0.04em] text-white">${displayLatency}ms</span>
      </div>
      <svg class="latency-mini-chart" viewBox="0 0 220 72" preserveAspectRatio="none" aria-hidden="true">
        <path d="${buildLatencySparkPath(values)}"></path>
      </svg>
    </div>
  `;
}

function renderTopologyTerminal(logs = currentLogs) {
  const shell = document.getElementById("topology-shell");
  if (!shell) return;

  shell.querySelector(".topology-terminal")?.remove();
  if (!state.selectedTopologyService) return;

  const serviceLogs = logs.filter((log) => log.service === state.selectedTopologyService).slice(0, 5);
  const terminal = document.createElement("div");
  terminal.className = "topology-terminal";
  terminal.innerHTML = `
    <div class="mb-2 flex items-center justify-between">
      <p class="text-[10px] uppercase tracking-[0.25em] text-cyan-200/70">${state.selectedTopologyService} pod logs</p>
      <button id="close-topology-terminal" class="text-xs text-white/45" type="button">Close</button>
    </div>
    <div class="space-y-1">
      ${serviceLogs.map((log) => `<div class="topology-terminal-line">${escapeHtml(log.level.toUpperCase())} ${escapeHtml(log.errorCode || "EVENT")} ${escapeHtml(log.message)}</div>`).join("") || `<div class="topology-terminal-line">No recent logs.</div>`}
    </div>
  `;
  shell.appendChild(terminal);
  terminal.querySelector("#close-topology-terminal")?.addEventListener("click", () => {
    state.selectedTopologyService = null;
    terminal.remove();
  });
}

function updateReplayControls() {
  const slider = document.getElementById("replay-slider");
  const label = document.getElementById("replay-label");
  if (!slider || !label) return;

  const sliderMax = 50;
  const historyLength = systemStateHistory.length;
  slider.max = String(sliderMax);
  slider.value = isReplaying && state.replayIndex !== null && historyLength > 1
    ? String(Math.round((state.replayIndex / (historyLength - 1)) * sliderMax))
    : String(sliderMax);
  label.textContent = !isReplaying || state.replayIndex === null
    ? "Following live stream"
    : `Replay frame ${state.replayIndex + 1}/${historyLength}`;
}

function updateEmergencyMode(logs) {
  const errorRate = getErrorRate(logs);
  const degraded = errorRate > 0.15;
  degradedOverlay?.classList.toggle("hidden", !degraded);
  if (!state.upgradeInProgress && state.incidentMode === "normal") {
    setPrimaryGlow(degraded ? "#fb7185" : "#00f2fe");
  }
  if (degraded && !state.anomalyPrompted) {
    state.anomalyPrompted = true;
    showSupportModal();
    document.getElementById("support-chat-panel")?.classList.remove("hidden");
    appendSupportChatMessage("bot", "Anomaly detected in Payments service. Investigate?");
  }
  if (!degraded) state.anomalyPrompted = false;
}

function updateReactiveMetricPods(snapshot) {
  const logs = snapshot.logs || [];
  const incidents = snapshot.incidents || [];
  const cohortValue = document.getElementById("cohort-sync-value");
  const rootCauseValue = document.getElementById("root-cause-value");
  const runtimeValue = document.getElementById("runtime-stability-value");
  const memoryValue = document.getElementById("memory-drift-value");
  const runtimePod = document.getElementById("runtime-stability-pod");
  const memoryPod = document.getElementById("memory-drift-pod");
  const rootCausePath = document.getElementById("root-cause-sparkline-path");
  const memoryWarning = document.getElementById("memory-drift-warning");
  if (!cohortValue || !rootCauseValue || !runtimeValue || !memoryValue) return;

  const totalNodes = 12;
  const errorCount = logs.filter((log) => log.level === "error").length;
  const warnCount = logs.filter((log) => log.level === "warn").length;
  const avgLatency = Number.isFinite(snapshot.latency)
    ? snapshot.latency
    : (logs.length > 0
      ? logs.reduce((sum, log) => sum + (typeof log.latencyMs === "number" ? log.latencyMs : 90), 0) / logs.length
      : 90);
  const onlineNodes = Math.max(0, totalNodes - Math.min(totalNodes, errorCount));
  const rootCauseSpan = incidents[0] ? Math.min(12, incidents[0].eventCount * 0.7) : 4.2;
  const lastHundred = logs.slice(0, 100);
  const infoCount = lastHundred.filter((log) => log.level === "info").length;
  const runtimeStability = lastHundred.length === 0 ? 100 : (infoCount / lastHundred.length) * 100;
  const memoryDrift = Math.max(0.8, Math.min(6.2, 0.8 + (snapshot.memory || 0) / 20 + errorCount * 0.18 + warnCount * 0.08 + avgLatency / 400));

  cohortValue.textContent = `${onlineNodes}/${totalNodes}`;
  animateMetricText(rootCauseValue, rootCauseSpan, { suffix: "m", decimals: 1 });
  animateMetricText(runtimeValue, runtimeStability, { suffix: "%", decimals: 2 });
  animateMetricText(memoryValue, memoryDrift, { suffix: "GB", decimals: 1 });

  const spanSeries = [...logs]
    .slice(0, 6)
    .reverse()
    .map((log, index) => clamp((typeof log.latencyMs === "number" ? log.latencyMs / 40 : 2.4) + index * 0.2, 1.6, 6.4));
  if (rootCausePath) {
    rootCausePath.setAttribute("d", buildMetricSparklinePath(spanSeries.length > 1 ? spanSeries : [3.2, 4.1, 3.8, 4.5, 4.2]));
  }

  runtimePod?.classList.toggle("status-critical", runtimeStability < 98);
  runtimePod?.classList.toggle("status-amber", runtimeStability < 98);
  memoryPod?.classList.toggle("status-red-alert", memoryDrift > 2.5);
  memoryPod?.classList.toggle("status-critical", memoryDrift > 3);
  if (memoryWarning) {
    memoryWarning.textContent = memoryDrift > 2 ? "Memory Leak Detected" : "Memory within threshold";
    memoryWarning.classList.toggle("text-rose-300", memoryDrift > 2);
  }
}

function applyGlobalFilter() {
  if (state.currentRoute !== "#dashboard") return;

  const query = state.globalFilter.trim().toLowerCase();
  const widgets = [...document.querySelectorAll("[data-filter-tags]")];
  widgets.forEach((widget) => {
    widget.classList.remove("widget-dimmed", "widget-highlighted");
    if (!query) return;
    const tags = (widget.dataset.filterTags || "").toLowerCase();
    const isMatch = tags.includes(query);
    widget.classList.add(isMatch ? "widget-highlighted" : "widget-dimmed");
  });

  state.topologyNodes.forEach((node) => {
    node.hotTimer = query && node.id.includes(query) ? Math.max(node.hotTimer, 12) : node.hotTimer;
  });
}

function playThreatPing() {
  if (typeof window.AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined") return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!state.audioContext) state.audioContext = new AudioCtx();
  const ctx = state.audioContext;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(1480, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.015, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.1);
}

function updateThreatCount(logs) {
  const counter = document.getElementById("security-threat-count");
  if (!counter) return;
  const threatCount = logs.filter((log) => {
    const statusCode = Number(log.statusCode || 0);
    return statusCode >= 400;
  }).length;
  counter.textContent = String(threatCount);
  counter.classList.toggle("text-rose-300", threatCount > 0);
  if (threatCount > state.lastThreatCount) playThreatPing();
  state.lastThreatCount = threatCount;
}

function renderLogStatus(log) {
  const statusCode = Number(log.statusCode || 0);
  if (statusCode >= 500 || log.level === "error") {
    return `<span class="waf-log-error">${statusCode || 500}</span>`;
  }
  if (statusCode === 200 || log.level === "info") {
    return `<span class="text-emerald-300">200</span>`;
  }
  if (statusCode === 403 || statusCode === 404 || statusCode === 401) {
    return `<span class="waf-log-blocked">${statusCode}</span>`;
  }
  return `<span class="text-cyan-100/70">${escapeHtml(log.level.toUpperCase())}</span>`;
}

function openRunbook(errorCode) {
  state.selectedRunbookCode = errorCode;
  showSupportModal();
  if (supportSearchInput) supportSearchInput.value = errorCode;
  const runbookText = RUNBOOKS[errorCode] || "Inspect service logs, validate pod restarts, and confirm rollback posture before resuming traffic.";
  supportResults.innerHTML = `
    <article class="support-result-card">
      <p class="text-[10px] uppercase tracking-[0.25em] text-cyan-200/60">Runbook</p>
      <h3 class="mt-2 text-lg font-semibold text-white">${escapeHtml(errorCode)}</h3>
      <p class="mt-2 text-sm leading-7 text-[#c0cbf7]/75">${escapeHtml(runbookText)}</p>
    </article>
  `;
}

function renderSupportResults(query = "") {
  if (!supportResults) return;
  const normalized = query.trim().toLowerCase();
  const entries = normalized
    ? state.supportEntries.filter((entry) => `${entry.title} ${entry.tags} ${entry.copy}`.toLowerCase().includes(normalized))
    : state.supportEntries;

  supportResults.innerHTML = entries.length > 0
    ? entries.map((entry) => `
        <article class="support-result-card">
          <p class="text-[10px] uppercase tracking-[0.25em] text-cyan-200/60">${entry.tags}</p>
          <h3 class="mt-2 text-lg font-semibold text-white">${entry.title}</h3>
          <p class="mt-2 text-sm leading-7 text-[#c0cbf7]/75">${entry.copy}</p>
        </article>
      `).join("")
    : `<div class="support-result-card"><p class="text-sm text-white/45">No matching knowledge fragments.</p></div>`;
}

function typeSupportTerminal(text) {
  if (!supportApiTerminal) return;
  const line = document.createElement("pre");
  line.className = "support-terminal-line";
  supportApiTerminal.prepend(line);
  let index = 0;

  function step() {
    line.textContent = text.slice(0, index);
    index += 1;
    if (index <= text.length) {
      window.setTimeout(step, 6);
    }
  }

  step();
}

async function runSupportApiTest(endpoint) {
  if (!supportApiTerminal) return;
  typeSupportTerminal(`$ curl ${endpoint}`);
  try {
    const response = await fetch(endpoint);
    const data = endpoint === "/health" ? await response.json() : await response.json();
    typeSupportTerminal(JSON.stringify(data, null, 2));
  } catch (error) {
    typeSupportTerminal(`ERROR: ${error.message}`);
  }
}

function startSimulatedLoad() {
  if (state.simulateLoadInterval) clearInterval(state.simulateLoadInterval);
  if (state.simulateLoadTimeout) clearTimeout(state.simulateLoadTimeout);
  typeSupportTerminal("Starting synthetic load: 10s burst against /api/logs");

  const runBurst = () => {
    fetch("/api/logs", { cache: "no-store" })
      .then(() => {})
      .catch((error) => typeSupportTerminal(`LOAD ERROR: ${error.message}`));
  };

  runBurst();
  state.simulateLoadInterval = window.setInterval(runBurst, 180);
  state.simulateLoadTimeout = window.setTimeout(() => {
    clearInterval(state.simulateLoadInterval);
    state.simulateLoadInterval = null;
    state.simulateLoadTimeout = null;
    typeSupportTerminal("Synthetic load completed.");
  }, 10000);
}

const toggleSupport = (force) => {
  const shouldOpen = typeof force === "boolean" ? force : !supportModal?.classList.contains("is-open");
  if (!supportModal) return;
  supportModal.classList.toggle("is-open", shouldOpen);
  if (!shouldOpen) {
    if (supportSearchInput) supportSearchInput.value = "";
    renderSupportResults("");
    return;
  }
  renderSupportResults(supportSearchInput?.value || "");
  if (supportApiTerminal && supportApiTerminal.childElementCount === 0) {
    typeSupportTerminal("Strata Knowledge Base ready. Select an endpoint to inspect live responses.");
  }
  supportSearchInput?.focus();
};

function primeCommandPalette(prompt) {
  openCommandPalette();
  commandInput.value = prompt;
  filterCommands(prompt);
}

function showSupportModal() {
  toggleSupport(true);
}

function hideSupportModal() {
  toggleSupport(false);
}

function initializeSupportModule() {
  if (state.supportBound) return;
  state.supportBound = true;

  document.addEventListener("click", (event) => {
    const supportTrigger = event.target.closest("#support-trigger, [data-support-trigger]");
    const apiButton = event.target.closest(".api-test-button");
    const quickStartButton = event.target.closest(".support-quickstart");
    const simulateLoadButton = event.target.closest("#simulate-load-button");
    const runbookLink = event.target.closest(".runbook-link");
    if (supportTrigger) showSupportModal();
    if (apiButton) runSupportApiTest(apiButton.dataset.endpoint).catch(console.error);
    if (simulateLoadButton) {
      startSimulatedLoad();
      return;
    }
    if (quickStartButton) {
      hideSupportModal();
      primeCommandPalette(quickStartButton.dataset.supportPrompt || "How do I...");
    }
    if (runbookLink) openRunbook(runbookLink.dataset.errorCode || "CRITICAL_ERROR");
  });

  closeSupportModalButton?.addEventListener("click", hideSupportModal);
  supportModal?.addEventListener("click", (event) => {
    if (event.target === supportModal || event.target.classList.contains("command-backdrop")) hideSupportModal();
  });
  supportSearchInput?.addEventListener("input", (event) => renderSupportResults(event.target.value));
  document.addEventListener("click", (event) => {
    const faqToggle = event.target.closest(".support-faq-toggle");
    const chatToggle = event.target.closest("#support-chat-toggle");
    const runbookStep = event.target.closest(".runbook-step");
    const remediateButton = event.target.closest(".runbook-remediate");
    if (faqToggle) {
      faqToggle.parentElement.querySelector(".support-faq-body")?.classList.toggle("hidden");
    }
    if (chatToggle) {
      document.getElementById("support-chat-panel")?.classList.toggle("hidden");
    }
    if (runbookStep) {
      const progress = document.getElementById("runbook-fix-progress");
      const bar = document.getElementById("runbook-fix-progress-bar");
      if (!progress || !bar) return;
      progress.classList.remove("hidden");
      bar.style.width = "0%";
      let percent = 0;
      const timer = window.setInterval(() => {
        percent += 10;
        bar.style.width = `${percent}%`;
        if (percent >= 100) {
          clearInterval(timer);
          progress.classList.add("hidden");
          document.getElementById("fix-button")?.click();
        }
      }, 180);
    }
    if (remediateButton) {
      const progress = document.getElementById("runbook-fix-progress");
      const bar = document.getElementById("runbook-fix-progress-bar");
      if (!progress || !bar) return;
      progress.classList.remove("hidden");
      bar.style.width = "0%";
      let percent = 0;
      const timer = window.setInterval(() => {
        percent += 12.5;
        bar.style.width = `${percent}%`;
        if (percent >= 100) {
          clearInterval(timer);
          progress.classList.add("hidden");
          document.querySelectorAll("[id^='deploy-node-'].is-error").forEach((node) => {
            node.classList.remove("is-error");
            node.classList.add("is-active");
            node.querySelector(".deploy-node-status").textContent = "Status: Running";
          });
        }
      }, 160);
    }
  });
  document.getElementById("support-chat-form")?.addEventListener("submit", handleChatSubmit);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSupportModal();
  });
  renderSupportResults("");
}

function appendSupportChatMessage(role, text) {
  const mount = document.getElementById("support-chat-messages");
  if (!mount) return;
  const line = document.createElement("div");
  line.className = `support-chat-msg ${role}`;
  line.textContent = text;
  mount.appendChild(line);
  mount.scrollTop = mount.scrollHeight;
}

function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("support-chat-input");
  const mount = document.getElementById("support-chat-messages");
  const query = input?.value.trim();
  if (!query || !mount) return;
  appendSupportChatMessage("user", query);
  input.value = "";
  appendSupportChatMessage("bot", "...");
  window.setTimeout(() => {
    mount.lastElementChild?.remove();
    const normalized = query.toLowerCase();
    if (normalized.includes("system check")) {
      const uptime = formatUptime(state.latestHealth?.uptime || 0);
      const memoryPressure = getMemoryPressurePercent();
      appendSupportChatMessage("bot", `System check: uptime ${uptime}, heap pressure ${memoryPressure}%, request buffer ${state.latestLogs.length}/50.`);
      return;
    }
    if (normalized.includes("status")) {
      const authPressure = state.latestLogs.filter((log) => log.service === "auth" && (log.latencyMs || 0) > 120).length;
      appendSupportChatMessage("bot", `Gateway is stable, but ${authPressure || 2} Auth pods are reporting high latency.`);
      return;
    }
    if (normalized.includes("health")) {
      const readyPods = Math.max(0, 12 - state.latestLogs.filter((log) => log.level === "error").length);
      appendSupportChatMessage("bot", `${readyPods} pods are currently Ready.`);
      return;
    }
    if (normalized.includes("server doing")) {
      const requests = parseMetricsCounter(state.latestMetricsText, "http_requests_total");
      const uptime = state.latestHealth?.uptime ? `${Math.round(state.latestHealth.uptime)}s` : "unknown";
      appendSupportChatMessage("bot", `Server uptime is ${uptime} with ${requests} requests observed so far.`);
      return;
    }
    if (normalized.includes("clear logs")) {
      appendSupportChatMessage("bot", "Acknowledged. Purging buffer...");
      clearLogs().catch(() => {});
      return;
    }
    if (normalized.includes("scale payments")) {
      appendSupportChatMessage("bot", "Scaling Payments service to 3 replicas...");
      window.location.hash = "#cluster";
      window.setTimeout(() => {
        const clusterGrid = document.getElementById("deployment-node-grid");
        if (!clusterGrid) return;
        for (let count = 0; count < 2; count += 1) {
          const nextIndex = clusterGrid.querySelectorAll("[id^='deploy-node-']").length;
          const node = document.createElement("div");
          node.id = `deploy-node-${nextIndex}`;
          node.className = "cluster-node liquid-glass rounded-[18px] min-h-[120px] p-3 flex flex-col justify-between is-active";
          node.innerHTML = `
            <span class="text-[10px] uppercase tracking-[0.22em] text-white/45">payments-svc-${7 + nextIndex}x${2 + (nextIndex % 4)}</span>
            <span class="deploy-node-service text-sm font-medium text-white/80">payments</span>
            <span class="deploy-node-cpu text-[11px] uppercase tracking-[0.2em] text-white/55">CPU: 18%</span>
            <span class="deploy-node-status text-[10px] uppercase tracking-[0.22em] text-cyan-100/70">Status: Running</span>
          `;
          clusterGrid.appendChild(node);
        }
      }, 220);
      return;
    }
    if (normalized.includes("logs")) {
      appendSupportChatMessage("bot", state.latestLogs.slice(0, 3).map((log) => `[${log.service}] ${log.message}`).join(" | "));
      return;
    }
    appendSupportChatMessage("bot", "Ask for Health or Logs and I will query the current control plane state.");
  }, 1000);
}

function initializeUpgradeModule() {
  const button = document.getElementById("upgrade-initiate-button");
  const progressBar = document.getElementById("upgrade-progress-bar");
  const status = document.getElementById("upgrade-status-text");
  const terminal = document.getElementById("upgrade-terminal");
  const versionLabel = document.getElementById("upgrade-version-label");
  const canaryNodes = [...document.querySelectorAll("[id^='upgrade-canary-node-']")];
  if (terminal && terminal.childElementCount === 0) {
    terminal.innerHTML = `<div class="intrusion-entry text-cyan-100/80">System Integrity Checks pending.</div>`;
  }
  if (!button || !progressBar || !status || button.dataset.bound === "true") return;
  button.dataset.bound = "true";

  button.addEventListener("click", () => {
    if (state.upgradeInProgress) return;
    state.upgradeInProgress = true;
    const start = performance.now();
    const duration = 10_000;
    button.classList.add("is-morphing");
    status.textContent = "Reskin deployment in progress";
    if (terminal) terminal.innerHTML = "";
    clearInterval(state.upgradeBootInterval);
    let lineIndex = 0;
    state.upgradeBootInterval = window.setInterval(() => {
      if (!terminal || lineIndex >= UPGRADE_TERMINAL_LINES.length) {
        clearInterval(state.upgradeBootInterval);
        state.upgradeBootInterval = null;
        return;
      }
      const line = document.createElement("div");
      line.className = "intrusion-entry text-cyan-100/90";
      line.textContent = UPGRADE_TERMINAL_LINES[lineIndex];
      terminal.prepend(line);
      lineIndex += 1;
    }, 1200);

    function tick(now) {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      progressBar.style.width = `${eased * 100}%`;
      versionLabel.textContent = `v1.0 stable -> v1.1 canary (${Math.round(eased * 10)}0% traffic shifted)`;
      const canaryCount = Math.max(1, Math.round(eased * canaryNodes.length));
      canaryNodes.forEach((node, index) => node.classList.toggle("is-canary", index < canaryCount));

      const r = Math.round(0 + (110 - 0) * eased);
      const g = Math.round(242 + (231 - 242) * eased);
      const b = Math.round(254 + (183 - 254) * eased);
      document.documentElement.style.setProperty("--primary-rgb", `${r}, ${g}, ${b}`);

      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }

      button.classList.remove("is-morphing");
      button.classList.add("is-success");
      status.textContent = "Upgrade deployed: primary glow remapped";
      state.upgradeInProgress = false;
      clearInterval(state.upgradeBootInterval);
      state.upgradeBootInterval = null;
    }

    requestAnimationFrame(tick);
  });
}

function startCanaryDeployment() {
  const progressBar = document.getElementById("deploy-canary-progress");
  const status = document.getElementById("deploy-canary-status");
  const nodes = [...document.querySelectorAll("[id^='deploy-node-']")];
  if (!progressBar || !status || nodes.length === 0 || state.canaryInProgress) return;

  state.canaryInProgress = true;
  const start = performance.now();
  const duration = 10_000;

  function tick(now) {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    progressBar.style.width = `${eased * 100}%`;
    const canaryCount = Math.max(1, Math.round(eased * nodes.length * 0.1));
    nodes.forEach((node, index) => {
      node.classList.toggle("is-active", index >= canaryCount);
      node.classList.toggle("is-error", false);
      node.style.borderColor = index < canaryCount ? "rgba(52, 211, 153, 0.45)" : "";
      node.style.boxShadow = index < canaryCount ? "0 0 18px rgba(52, 211, 153, 0.24)" : "";

      let statusEl = node._statusEl || (node._statusEl = node.querySelector(".deploy-node-status"));
      statusEl.textContent = index < canaryCount ? "v2 canary" : "v1 stable";
    });
    status.textContent = `Canary in flight: v2 serving ${Math.round(eased * 10)}% of traffic`;
    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    state.canaryInProgress = false;
    status.textContent = "Canary complete: v2 healthy across the cluster";
  }

  requestAnimationFrame(tick);
}

function updateDashboardView(snapshot) {
  if (state.currentRoute !== "#dashboard") return;
  const incidents = snapshot.incidents || [];
  const logs = snapshot.logs || [];

  const incidentList = document.getElementById("incident-list");
  const logList = document.getElementById("log-list");
  const incidentCount = document.getElementById("incident-count");
  const topSeverityReadout = document.getElementById("top-severity-readout");
  const topSeveritySummary = document.getElementById("top-severity-summary");
  const pulsePressure = document.getElementById("pulse-pressure");
  const pulseService = document.getElementById("pulse-service");
  const criticalLoadValue = document.getElementById("critical-load-value");
  const automationValue = document.getElementById("automation-value");
  const watchersValue = document.getElementById("watchers-value");
  if (!incidentList || !logList || !incidentCount) return;

  const criticalLoad = state.incidentMode === "critical" ? 99 : clamp(Math.round((snapshot.cpu * 0.58) + (snapshot.memory * 0.42)), 42, 98);
  if (criticalLoadValue) criticalLoadValue.textContent = `${criticalLoad}%`;
  if (automationValue) automationValue.textContent = `${state.incidentMode === "critical" ? "12.0" : (state.incidentMode === "remediating" ? "96.4" : "98.4")}%`;
  if (watchersValue) watchersValue.textContent = String(state.incidentMode === "critical" ? 27 : state.incidentMode === "remediating" ? 18 : 12);

  incidentCount.textContent = `${incidents.length} incidents`;
  if (incidents.length === 0) {
    incidentList.innerHTML = `<div class="incident-shell"><p class="incident-copy">No active incident refractions detected. The surface is clear.</p></div>`;
    if (topSeverityReadout) topSeverityReadout.textContent = "Stable";
    if (topSeveritySummary) topSeveritySummary.textContent = "No high-pressure clusters are currently forming across the live stream.";
    if (pulsePressure) pulsePressure.textContent = "Nominal";
    if (pulseService) pulseService.textContent = "No dominant service";
  } else {
    const topIncident = incidents[0];
    if (topSeverityReadout) topSeverityReadout.textContent = severityTone(topIncident.severity);
    if (topSeveritySummary) topSeveritySummary.textContent = topIncident.summary;
    if (pulsePressure) pulsePressure.textContent = severityTone(topIncident.severity);
    if (pulseService) pulseService.textContent = topIncident.service;
    incidentList.innerHTML = incidents.slice(0, 3).map((incident) => `
      <article class="incident-shell ${severityClass(incident.severity)}">
        <div class="incident-header">
          <span class="incident-service"><span class="incident-dot ${incident.severity === "critical" ? "is-critical" : "is-watch"}"></span>${incident.service}</span>
          <span class="incident-score">Score ${incident.score}</span>
        </div>
        <div>
          <h3 class="text-xl font-semibold text-white">${incident.errorCode}</h3>
          <p class="incident-copy">${incident.summary}</p>
        </div>
        <div class="incident-meta">
          <span>${incident.eventCount} events</span>
          <span>${incident.severity}</span>
          <span>${new Date(incident.latestTimestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <button class="liquid-chip runbook-link mt-2" data-error-code="${incident.errorCode}" type="button">Fix Now</button>
      </article>
    `).join("");
  }

  if (logs.length === 0) {
    logList.innerHTML = `<div class="log-shell"><p class="log-message">No logs are flowing into the surface right now.</p></div>`;
  } else {
    logList.innerHTML = logs.slice(0, 6).map((log) => `
      <article class="log-shell">
        <div class="log-row">
          <span class="log-time">${new Date(log.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <span class="log-service">${log.service}</span>
          <span class="log-level level-${log.level}">${log.level}</span>
        </div>
        <p class="log-message">${log.message}</p>
      </article>
    `).join("");
  }

  renderChart(buildChartSeries(logs));
  renderLatencyPod(snapshot);
  updateReactiveMetricPods(snapshot);
  updateServiceSparkline("gateway", "Ingress Shear", logs);
  updateServiceSparkline("payments", "Settlement Elasticity", logs);
  initializeChartScrubber();
  applyGlobalFilter();
  renderTopologyTerminal(logs);
}

function flashDeploymentNode(node, className) {
  if (!node) return;
  node.classList.remove("is-active", "is-error");
  node.classList.add(className);
  clearTimeout(node._flashTimer);
  node._flashTimer = window.setTimeout(() => node.classList.remove(className), 1200);
}

function updateDeploymentsView(snapshot) {
  if (state.currentRoute !== "#cluster") return;
  const logs = snapshot.logs || [];
  const nodes = [...document.querySelectorAll("[id^='deploy-node-']")];
  const stream = document.getElementById("deployment-event-stream");
  const nodeACount = document.getElementById("node-a-count");
  const nodeBCount = document.getElementById("node-b-count");
  const clusterLoadBar = document.getElementById("resource-cpu-bar");
  const clusterLoadReadout = document.getElementById("cluster-load-readout");
  const clusterMemoryBar = document.getElementById("resource-memory-bar");
  const clusterMemoryReadout = document.getElementById("cluster-memory-readout");
  const clusterMemoryDetail = document.getElementById("cluster-memory-detail");
  const equalizer = document.getElementById("traffic-equalizer");
  if (nodes.length === 0 || !stream) return;

  const health = state.latestHealth || {};
  const services = health.services || ["gateway", "auth", "payments"];
  let nodeA = 0;
  let nodeB = 0;
  nodes.forEach((node, index) => {
    const log = logs[index];
    const service = services[index % services.length];
    const cpu = clamp(Math.round((health.cpuPercent || 20) + (index % 3) * 6), 10, 96);
    node.querySelector(".deploy-node-service").textContent = log?.service || service;
    node.querySelector(".deploy-node-cpu").textContent = `CPU: ${cpu}%`;
    const fiveHundred = Number(log?.statusCode || 0) >= 500;
    const crashState = fiveHundred && Math.random() > 0.5 ? "Status: Terminating" : "Status: CrashLoopBackOff";
    node.querySelector(".deploy-node-status").textContent = log?.level === "error" || fiveHundred ? crashState : log?.level === "warn" ? "Status: Degraded" : "Status: Running";
    node.classList.remove("is-active", "is-error");
    if (log?.level === "error" || fiveHundred) {
      node.classList.add("is-error");
      clearTimeout(node._statusTimer);
      node._statusTimer = window.setTimeout(() => {
        node.classList.remove("is-error");
        node.classList.add("is-active");
        node.querySelector(".deploy-node-status").textContent = "Status: Running";
      }, 15000);
    } else if (log) {
      node.classList.add("is-active");
    }
    if (index % 2 === 0) nodeA += 1; else nodeB += 1;
  });
  if (nodeACount) nodeACount.textContent = String(nodeA);
  if (nodeBCount) nodeBCount.textContent = String(nodeB);

  const clusterLoad = clamp(Math.round(Number.isFinite(snapshot.cpu) ? snapshot.cpu : health.cpuPercent || 0), 0, 100);
  const memoryPressure = clamp(Math.round(Number.isFinite(snapshot.memory) ? snapshot.memory : getMemoryPressurePercent(health)), 0, 100);
  const heapUsedMb = getHeapUsedMegabytes(health);
  if (clusterLoadBar) clusterLoadBar.style.width = `${clusterLoad}%`;
  if (clusterLoadReadout) clusterLoadReadout.textContent = `${clusterLoad}%`;
  if (clusterMemoryBar) clusterMemoryBar.style.width = `${memoryPressure}%`;
  if (clusterMemoryReadout) clusterMemoryReadout.textContent = `${memoryPressure}%`;
  if (clusterMemoryDetail) clusterMemoryDetail.textContent = `${heapUsedMb} MB heap used`;

  const steps = ["Build", "Verify", "Release", "Shift"];
  stream.innerHTML = steps.map((step, index) => `
    <div class="pipeline-stepper-row ${index === (snapshot.deploymentStep ?? state.deploymentStep) ? "is-active" : index < (snapshot.deploymentStep ?? state.deploymentStep) ? "is-complete" : ""}">
      <span class="pipeline-stepper-dot"></span>
      <div>
        <p class="text-sm font-medium text-white">${step}</p>
        <p class="mt-1 text-xs text-white/50">${index === (snapshot.deploymentStep ?? state.deploymentStep) ? "Currently pulsing through the control plane." : "Stable deployment telemetry frame."}</p>
      </div>
    </div>
  `).join("");

  if (equalizer) {
    const bars = snapshot.trafficBars || state.trafficBars;
    equalizer.innerHTML = bars.map((height, index) => `
      <span class="traffic-bar ${state.incidentMode === "critical" ? "is-critical" : ""}" style="height:${clamp(height, 20, 100)}px; animation-delay:${index * 60}ms"></span>
    `).join("");
  }
}

function typeIntrusionEntry(container, text) {
  const entry = document.createElement("div");
  entry.className = "intrusion-entry";
  container.prepend(entry);
  let index = 0;

  function step() {
    entry.textContent = text.slice(0, index);
    index += 1;
    if (index <= text.length) {
      setTimeout(step, 12);
    }
  }

  step();
}

function updateSecurityView(logs) {
  if (state.currentRoute !== "#security") return;
  const stream = document.getElementById("security-intrusion-stream");
  const blockedStream = document.getElementById("security-blocked-stream");
  const topPaths = document.getElementById("security-top-paths");
  const scanSummary = document.getElementById("security-scan-summary");
  if (!stream) return;
  updateThreatCount(logs);
  const query = document.getElementById("logs-filter-input")?.value.trim().toLowerCase() || "";
  const blocked = logs.filter((log) => {
    const statusCode = Number(log.statusCode || 0);
    return statusCode >= 400;
  });
  const pathCounts = logs.reduce((acc, log) => {
    const path = log.path || "/";
    acc.set(path, (acc.get(path) || 0) + 1);
    return acc;
  }, new Map());
  const topPathEntries = [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const scanEntries = logs.filter((log) => {
    const statusCode = Number(log.statusCode || 0);
    return statusCode === 403 || statusCode === 404;
  });

  const filteredLogs = logs.filter((log) => {
    const haystack = `${log.service} ${log.level} ${log.errorCode || ""} ${log.message || ""} ${log.path || ""} ${log.clientIp || ""}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  if (blockedStream) {
    blockedStream.innerHTML = blocked.slice(0, 6).map((log) => {
      return `<div class="intrusion-entry waf-log-error">${escapeHtml(log.clientIp || "unknown")} [${escapeHtml(log.service.toUpperCase())}] ${Number(log.statusCode || 500)} ${escapeHtml(log.path || "/")} ${escapeHtml(log.method || "GET")} ${escapeHtml(log.message || "")}</div>`;
    }).join("") || `<div class="intrusion-entry text-white/35">No blocked requests detected.</div>`;
  }

  if (topPaths) {
    topPaths.innerHTML = topPathEntries.map(([path, count]) => `
      <div class="mini-surface">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-white">${escapeHtml(path)}</span>
          <span class="text-[10px] uppercase tracking-[0.25em] text-cyan-200/70">${count} req</span>
        </div>
      </div>
    `).join("") || `<div class="mini-surface"><span class="text-sm text-white/45">No traffic sampled yet.</span></div>`;
  }

  if (scanSummary) {
    const grouped = [...scanEntries.reduce((acc, log) => {
      const key = log.path || "/";
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    scanSummary.innerHTML = grouped.map(([path, count]) => `
      <div class="mini-surface">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-white">${escapeHtml(path)}</span>
          <span class="text-[10px] uppercase tracking-[0.25em] text-rose-300">${count} blocked</span>
        </div>
        <p class="mt-2 text-xs text-[#ffd4dd]/75">Potential scan activity detected on this path.</p>
      </div>
    `).join("") || `<div class="mini-surface"><span class="text-sm text-white/45">No scan spikes detected.</span></div>`;
  }

  if (filteredLogs.length === 0) {
    stream.innerHTML = `<div class="intrusion-entry text-white/35">No logs match the current filter.</div>`;
    return;
  }

  stream.innerHTML = filteredLogs.slice(0, 6).map((log) => `
    <div class="intrusion-entry">
      [${escapeHtml(log.service.toUpperCase())}] ${renderLogStatus(log)} ${escapeHtml(log.path || "/")} ${escapeHtml(log.message)}
    </div>
  `).join("");
}

async function loadDashboard() {
  if (state.isLoading) return;
  state.isLoading = true;

  try {
    const [incidentsResponse, logsResponse, healthResponse, metricsResponse] = await Promise.all([
      fetch("/api/incidents"),
      fetch("/api/logs"),
      fetch("/health"),
      fetch("/metrics")
    ]);
    if (!incidentsResponse.ok || !logsResponse.ok || !healthResponse.ok || !metricsResponse.ok) throw new Error("Dashboard refresh failed");

    const incidentsData = await incidentsResponse.json();
    const logsData = await logsResponse.json();
    const healthData = await healthResponse.json();
    const metricsText = await metricsResponse.text();
    if (!currentLogs.length && Array.isArray(logsData) && logsData.length > 0) {
      currentLogs = structuredClone(logsData);
    }
    state.latestIncidents = incidentsData.incidents || state.latestIncidents || [];
    state.latestLogs = Array.isArray(logsData) ? logsData : logsData.logs || [];
    state.latestHealth = { ...state.latestHealth, ...healthData };
    state.latestMetricsText = metricsText;

    const mostRecentLog = state.latestLogs[0];
    state.topologyNodes.forEach((node) => {
      const serviceLog = state.latestLogs.find((log) => log.service === node.id);
      node.statusLabel = serviceLog?.level === "error" ? "CrashLoopBackOff" : "Ready";
      node.targetX = node.id === "gateway" ? 20 : node.id === "auth" ? 70 : 80;
      node.targetY = node.id === "gateway" ? 50 : node.id === "auth" ? 30 : 70;
      if (serviceLog) node.pulseRadius = Math.max(node.pulseRadius, 3);
    });
    if (mostRecentLog?.id && mostRecentLog.id !== state.lastSeenLogId) {
      const impactPoint = deriveTrafficCoordinate(mostRecentLog);
      const closestNode = findClosestTopologyNode(impactPoint);
      kickTopologyNode(closestNode, mostRecentLog.statusCode >= 400 ? 1.4 : 1);
      state.lastSeenLogId = mostRecentLog.id;
    }
    if (mostRecentLog?.level === "error") {
      const hotNode = state.topologyNodes.find((node) => node.id === mostRecentLog.service);
      if (hotNode) {
        hotNode.statusLabel = "CrashLoopBackOff";
        kickTopologyNode(hotNode, 1.6);
      }
    }
    if (mostRecentLog) {
      const text = `${mostRecentLog.errorCode || ""} ${mostRecentLog.message || ""}`;
      if (text.includes("401") || text.includes("403")) {
        state.radarBlips.push({
          x: 20 + Math.random() * 60,
          y: 20 + Math.random() * 60,
          expiresAt: Date.now() + 5000
        });
      }
    }
    state.radarBlips = state.radarBlips.filter((blip) => blip.expiresAt > Date.now());

  } finally {
    state.isLoading = false;
  }
}

function getTelemetryProfile() {
  if (state.incidentMode === "critical") {
    return {
      cpu: 98,
      memory: 98,
      latency: 1402,
      burst: 4,
      barMin: 96,
      barMax: 100,
      levelBias: "error"
    };
  }

  if (state.incidentMode === "remediating") {
    return {
      cpu: clamp(Math.round(82 - telemetryTickCount * 1.2), 52, 86),
      memory: clamp(Math.round(78 - telemetryTickCount * 0.9), 48, 82),
      latency: clamp(Math.round(420 - telemetryTickCount * 18), 92, 460),
      burst: 2,
      barMin: 42,
      barMax: 74,
      levelBias: "warn"
    };
  }

  return {
    cpu: clamp(52 + Math.round(Math.sin(telemetryTickCount / 2) * 18) + Math.round(Math.random() * 6), 40, 85),
    memory: clamp(48 + Math.round(Math.cos(telemetryTickCount / 2.3) * 15) + Math.round(Math.random() * 6), 40, 85),
    latency: clamp(72 + Math.round(Math.sin(telemetryTickCount / 2.6) * 24) + Math.round(Math.random() * 20), 48, 168),
    burst: 2,
    barMin: 20,
    barMax: 100,
    levelBias: "mixed"
  };
}

function generateMockLog(profile, index = 0) {
  const service = TELEMETRY_SERVICES[(telemetryTickCount + index) % TELEMETRY_SERVICES.length];
  const path = TELEMETRY_PATHS[(telemetryTickCount + index) % TELEMETRY_PATHS.length];
  const forceError = profile.levelBias === "error";
  const forceWarn = profile.levelBias === "warn";
  const level = forceError ? "error" : forceWarn ? (index % 2 === 0 ? "warn" : "info") : (index === 0 && telemetryTickCount % 5 === 0 ? "warn" : "info");
  const statusCode = level === "error" ? 503 : level === "warn" ? 429 : 200;
  const responseTime = clamp(Math.round(profile.latency + (Math.random() - 0.5) * (forceError ? 140 : 36)), 24, 1800);
  const messagePool = TELEMETRY_MESSAGES[service];
  const baseMessage = forceError
    ? `[CRITICAL] ${service.toUpperCase()} saturation detected on ${path}`
    : forceWarn
      ? `[ACTION] ${service} lane under remediation watch`
      : messagePool[(telemetryTickCount + index) % messagePool.length];

  return {
    id: `telemetry-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date(Date.now() - index * 220).toISOString(),
    method: index % 3 === 0 ? "POST" : "GET",
    url: path,
    path,
    status: statusCode,
    statusCode,
    responseTime,
    responseTimeMs: responseTime,
    latencyMs: responseTime,
    service,
    level,
    clientIp: `10.42.${(telemetryTickCount + index) % 9}.${20 + index}`,
    errorCode: forceError ? "CRITICAL_ERROR" : forceWarn ? "AUTO_REMEDIATION" : "HTTP_OK",
    message: baseMessage
  };
}

function deriveTelemetryIncidents(logs, profile) {
  return INCIDENT_LIBRARY.map((incident, index) => ({
    ...incident,
    score: state.incidentMode === "critical" ? 96 - index * 2 : state.incidentMode === "remediating" ? 68 - index * 4 : 58 + index * 8,
    eventCount: state.incidentMode === "critical" ? 42 - index * 6 : state.incidentMode === "remediating" ? 18 - index * 3 : 9 + index * 3,
    severity: state.incidentMode === "critical" ? "critical" : index === 0 ? "high" : "medium",
    latestTimestamp: logs[index]?.timestamp || new Date().toISOString(),
    summary: state.incidentMode === "critical"
      ? `${incident.summary} Pressure has crossed the redline and live traffic is being shed.`
      : state.incidentMode === "remediating"
        ? `${incident.summary} Automated controls are dampening the blast radius.`
        : incident.summary
  }));
}

function syncCurrentTelemetry() {
  const profile = getTelemetryProfile();
  const newLogs = Array.from({ length: profile.burst }, (_, index) => generateMockLog(profile, index));
  currentLogs = [...newLogs, ...currentLogs].slice(0, 50);
  currentCpu = profile.cpu;
  currentMem = profile.memory;
  currentLat = profile.latency;
  currentTrafficBars = Array.from({ length: 15 }, (_, index) => clamp(
    Math.round(profile.barMin + Math.random() * (profile.barMax - profile.barMin) + (index % 3) * 3),
    20,
    100
  ));
  currentDeploymentStep = state.incidentMode === "critical"
    ? 1
    : state.incidentMode === "remediating"
      ? 2
      : telemetryTickCount % 4;
  currentIncidents = deriveTelemetryIncidents(currentLogs, profile);
  currentTelemetryTimestamp = Date.now();

  state.trafficBars = [...currentTrafficBars];
  state.deploymentStep = currentDeploymentStep;
  state.latestLogs = structuredClone(currentLogs);
  state.latestIncidents = structuredClone(currentIncidents);
  state.latestHealth = {
    uptime: Math.round(performance.now() / 1000),
    processID: 4242,
    cpuPercent: currentCpu,
    memoryPercent: currentMem,
    memory: {
      rss: 512 * 1024 * 1024,
      heapUsed: Math.round((220 + currentMem * 2.4) * 1024 * 1024)
    }
  };
  state.latestMetricsText = [
    "# HELP strata_requests_total Mock request count",
    "# TYPE strata_requests_total counter",
    `strata_requests_total{service="gateway"} ${1000 + telemetryTickCount * 4}`,
    `strata_cpu_percent ${currentCpu}`,
    `strata_memory_percent ${currentMem}`,
    `strata_latency_ms ${currentLat}`
  ].join("\n");
}

function renderHistoricalSnapshot(snapshot) {
  const frozenSnapshot = buildHistoricalRenderSnapshot(snapshot);
  document.body.classList.add("history-mode");
  if (state.currentRoute === "#dashboard") updateDashboardView(frozenSnapshot);
  if (state.currentRoute === "#cluster") updateDeploymentsView(frozenSnapshot);
  if (state.currentRoute === "#security") updateSecurityView(frozenSnapshot.logs || []);
  updateAmbientAnxiety(frozenSnapshot.incidents || [], frozenSnapshot.logs || []);
  updateEmergencyMode(frozenSnapshot.logs || []);
}

function renderLiveSnapshot() {
  const snapshot = buildLiveSnapshot();
  document.body.classList.remove("history-mode");
  if (state.currentRoute === "#dashboard") updateDashboardView(snapshot);
  if (state.currentRoute === "#cluster") updateDeploymentsView(snapshot);
  if (state.currentRoute === "#security") updateSecurityView(snapshot.logs || []);
  updateAmbientAnxiety(snapshot.incidents || [], snapshot.logs || []);
  updateEmergencyMode(snapshot.logs || []);
}

function startTelemetryEngine() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = window.setInterval(() => {
    syncCurrentTelemetry();
    telemetryTickCount += 1;

    if (telemetryTickCount % 2 === 0) {
      systemStateHistory.push(structuredClone({
        logs: currentLogs,
        cpu: currentCpu,
        memory: currentMem,
        latency: currentLat
      }));
      if (systemStateHistory.length > 50) systemStateHistory.shift();
      if (isReplaying && state.replayIndex !== null) {
        state.replayIndex = clamp(state.replayIndex, 0, Math.max(systemStateHistory.length - 1, 0));
      }
    }

    updateReplayControls();
    if (!isReplaying) renderLiveSnapshot();
  }, 1000);
}

function handleReplaySliderInput(event) {
  const sliderMax = Number(event.target.max || 50);
  const value = Number(event.target.value);

  if (value >= sliderMax || systemStateHistory.length === 0) {
    isReplaying = false;
    state.replayIndex = null;
    document.body.classList.remove("history-mode");
    updateReplayControls();
    renderLiveSnapshot();
    return;
  }

  isReplaying = true;
  document.body.classList.add("history-mode");
  state.replayIndex = clamp(
    Math.round((value / sliderMax) * (systemStateHistory.length - 1)),
    0,
    Math.max(systemStateHistory.length - 1, 0)
  );
  updateReplayControls();
  renderHistoricalSnapshot(structuredClone(systemStateHistory[state.replayIndex]));
}

async function clearLogs() {
  currentLogs = [];
  currentIncidents = [];
  systemStateHistory = [];
  state.latestLogs = [];
  state.latestIncidents = [];
  state.replayIndex = null;
  isReplaying = false;
  document.body.classList.remove("history-mode");
  try {
    const response = await fetch("/api/logs", { method: "DELETE" });
    if (!response.ok) throw new Error("Failed to clear logs");
  } catch (error) {
    console.error(error);
  }
  syncCurrentTelemetry();
  renderLiveSnapshot();
}

function openCommandPalette() {
  commandPalette.classList.add("is-open");
  renderCommandList();
  commandInput.focus();
}

function closePalette() {
  commandPalette.classList.remove("is-open");
  commandInput.value = "";
  state.selectedIndex = 0;
  state.filteredCommands = [...availableCommands];
  renderCommandList();
}

function openOpsTerminal() {
  opsTerminal?.classList.add("is-open");
  if (opsTerminalOutput && opsTerminalOutput.childElementCount === 0) {
    const line = document.createElement("div");
    line.className = "intrusion-entry text-cyan-100/80";
    line.textContent = "Terminal ready. Try `system.health`, `logs --tail`, or `scale --service auth`.";
    opsTerminalOutput.prepend(line);
  }
  opsTerminalInput?.focus();
}

function closeOpsTerminalShell() {
  opsTerminal?.classList.remove("is-open");
  if (state.followLogsInterval) {
    clearInterval(state.followLogsInterval);
    state.followLogsInterval = null;
  }
}

function writeOpsLine(text) {
  if (!opsTerminalOutput) return;
  const line = document.createElement("div");
  line.className = "intrusion-entry text-cyan-100/90";
  line.textContent = text;
  opsTerminalOutput.prepend(line);
}

function runOpsCommand(command) {
  writeOpsLine(`$ ${command}`);
  if (command === "kubectl get pods") {
    const services = state.topologyNodes.length > 0 ? state.topologyNodes : [
      { id: "gateway", isHot: false, statusLabel: "Ready" },
      { id: "auth", isHot: false, statusLabel: "Ready" },
      { id: "payments", isHot: false, statusLabel: "Ready" }
    ];
    services.forEach((node, index) => {
      writeOpsLine(`pod/${node.id}-${index + 1} ${node.isHot ? node.statusLabel : "Running"}`);
    });
    return;
  }

  if (command === "logs --follow" || command === "logs --tail") {
    if (state.followLogsInterval) clearInterval(state.followLogsInterval);
    state.followLogsInterval = window.setInterval(() => {
      const log = state.latestLogs[Math.floor(Math.random() * Math.max(state.latestLogs.length, 1))];
      if (log) writeOpsLine(JSON.stringify(log));
    }, 250);
    return;
  }

  if (command === "system.health") {
    const requests = parseMetricsCounter(state.latestMetricsText, "http_requests_total");
    writeOpsLine(JSON.stringify({
      uptime: state.latestHealth?.uptime ?? 0,
      processID: state.latestHealth?.processID ?? 0,
      cpuPercent: state.latestHealth?.cpuPercent ?? 0,
      memoryPercent: state.latestHealth?.memoryPercent ?? 0,
      requestCount: requests
    }));
    return;
  }

  if (command.startsWith("scale --service ")) {
    const service = command.replace("scale --service ", "").trim();
    if (!service) {
      writeOpsLine("missing service name");
      return;
    }
    const clusterGrid = document.getElementById("deployment-node-grid");
    if (!clusterGrid) {
      window.location.hash = "#cluster";
      writeOpsLine(`switch to #cluster to scale ${service}`);
      return;
    }
    const nextIndex = clusterGrid.querySelectorAll("[id^='deploy-node-']").length;
    const node = document.createElement("div");
    node.id = `deploy-node-${nextIndex}`;
    node.className = "cluster-node liquid-glass rounded-[18px] h-16 sm:h-20 p-2 flex flex-col justify-between is-active";
    node.innerHTML = `
      <span class="text-[10px] uppercase tracking-[0.22em] text-white/45">pod-${nextIndex + 1}</span>
      <span class="deploy-node-service text-sm font-medium text-white/80">${escapeHtml(service)}</span>
      <span class="deploy-node-status text-[10px] uppercase tracking-[0.22em] text-cyan-100/70">scaled</span>
    `;
    clusterGrid.appendChild(node);
    writeOpsLine(`scaled ${service}: pod-${nextIndex + 1} added`);
    return;
  }

  if (command === "deploy.canary") {
    window.location.hash = "#cluster";
    window.setTimeout(() => {
      startCanaryDeployment();
    }, 220);
    writeOpsLine("canary deployment initiated");
    return;
  }

  writeOpsLine("Unknown command");
}

const availableCommands = [
  { id: "clear-streams", title: "Clear All Telemetry Streams", subtitle: "Purge current logs and reset the live incident surface", icon: "delete", action: async () => clearLogs() },
  { id: "adaptive-rollback", title: "Trigger Adaptive Rollback", subtitle: "Invoke the automated rollback morph action", icon: "restart_alt", action: () => document.getElementById("fix-button")?.click() },
  { id: "toggle-focus", title: "Toggle Focus Mode", subtitle: "Switch depth-of-field emphasis on the main dashboard grid", icon: "center_focus_weak", action: () => {
      state.isFocusModeLocked = !state.isFocusModeLocked;
      document.body.classList.toggle("dof-enabled", state.isFocusModeLocked);
    } },
  { id: "critical-spike", title: "Simulate Critical Spike", subtitle: "Push the system load chart into a full-pressure surge", icon: "warning", action: () => simulateCriticalSpike() },
  { id: "pause-telemetry", title: "Pause Telemetry Stream", subtitle: "HALT THE LIVE DATA POLLING INTERVAL", icon: "pause", action: () => {
      if (state.pollHandle) {
        clearInterval(state.pollHandle);
        state.pollHandle = null;
      }
    } },
  { id: "resume-telemetry", title: "Resume Telemetry Stream", subtitle: "RESTART THE 3000ms DATA POLLING INTERVAL", icon: "play_arrow", action: () => {
      if (!state.pollHandle) {
        startTelemetryEngine();
      }
    } },
  { id: "export-logs", title: "Export System Logs (JSON)", subtitle: "DOWNLOAD CURRENT IN-MEMORY LOGS AS JSON", icon: "download", action: async () => {
      const res = await fetch("/api/logs");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nexus_logs_export.json";
      a.click();
      URL.revokeObjectURL(url);
    } }
];

state.filteredCommands = [...availableCommands];

function renderCommandList() {
  if (!commandList) return;

  if (state.filteredCommands.length === 0) {
    commandList.innerHTML = `<div class="liquid-glass flex items-center gap-4 p-3 rounded-xl border border-transparent transition-all"><span class="text-sm uppercase tracking-[0.3em] text-white/35">No match</span></div>`;
    return;
  }

  commandList.replaceChildren();
  state.filteredCommands.forEach((cmd, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.dataset.commandIndex = String(index);
    item.className = `flex items-center gap-4 p-4 rounded-2xl border ${index === state.selectedIndex ? "bg-white/10 border-cyan-400/30 shadow-[0_0_15px_rgba(0,242,254,0.15)]" : "bg-white/5 border-transparent"} cursor-pointer transition-all duration-200`;
    item.innerHTML = `
      <div class="flex-shrink-0 w-10 h-10 rounded-full bg-black/20 flex items-center justify-center border border-white/5">
        <span class="material-symbols-outlined ${index === state.selectedIndex ? "text-cyan-300" : "text-cyan-200/50"}">${cmd.icon}</span>
      </div>
      <div class="flex flex-col">
        <span class="text-white font-headline font-semibold tracking-wide">${cmd.title}</span>
        <span class="text-white/40 text-[10px] uppercase tracking-[0.25em] mt-0.5">${cmd.subtitle}</span>
      </div>
    `;
    item.addEventListener("mouseenter", () => {
      state.selectedIndex = index;
      renderCommandList();
    });
    item.addEventListener("click", () => {
      state.selectedIndex = index;
      executeSelectedCommand().catch(() => {});
    });
    commandList.appendChild(item);
  });

  commandList.querySelector(`[data-command-index="${state.selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
}

function filterCommands(query) {
  const normalized = query.trim().toLowerCase();
  state.filteredCommands = normalized
    ? availableCommands.filter((command) => command.title.toLowerCase().includes(normalized) || command.subtitle.toLowerCase().includes(normalized))
    : [...availableCommands];
  state.selectedIndex = 0;
  renderCommandList();
}

async function executeSelectedCommand() {
  const command = state.filteredCommands[state.selectedIndex];
  if (!command) return;
  await command.action();
  closePalette();
}

function initializeCommandPalette() {
  if (state.commandPaletteBound) return;
  state.commandPaletteBound = true;

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("#command-trigger");
    if (trigger) openCommandPalette();
  });

  closeCommandPalette.addEventListener("click", closePalette);
  commandPalette.addEventListener("click", (event) => {
    if (event.target === commandPalette || event.target.classList.contains("command-backdrop")) closePalette();
  });

  commandInput.addEventListener("input", (event) => filterCommands(event.target.value));
  commandInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.selectedIndex = clamp(state.selectedIndex + 1, 0, Math.max(state.filteredCommands.length - 1, 0));
      renderCommandList();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.selectedIndex = clamp(state.selectedIndex - 1, 0, Math.max(state.filteredCommands.length - 1, 0));
      renderCommandList();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      executeSelectedCommand().catch(() => {});
    }
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
    }
    if (event.key === "`") {
      event.preventDefault();
      if (opsTerminal?.classList.contains("is-open")) {
        closeOpsTerminalShell();
      } else {
        openOpsTerminal();
      }
    }
    if (event.key === "Escape") closePalette();
  });

  renderCommandList();
}

function initializeActionMorph() {
  const fixButton = document.getElementById("fix-button");
  if (!fixButton || fixButton.dataset.bound === "true") return;
  fixButton.dataset.bound = "true";
  fixButton.addEventListener("click", () => {
    if (state.incidentMode === "remediating") return;

    state.remediationTimers.forEach((timer) => clearTimeout(timer));
    state.remediationTimers = [];
    state.incidentMode = "remediating";
    setPrimaryGlow("#fbbf24");
    document.body.classList.remove("emergency-pulse");
    fixButton.classList.add("is-morphing");
    fixButton.classList.remove("is-success");
    fixButton.querySelector(".action-text").textContent = "Remediating...";
    syncCurrentTelemetry();
    if (!isReplaying) renderLiveSnapshot();

    state.remediationTimers.push(window.setTimeout(() => {
      writeOpsLine("[ACTION] Isolating pods...");
    }, 1000));
    state.remediationTimers.push(window.setTimeout(() => {
      writeOpsLine("[ACTION] Rerouting traffic...");
    }, 2000));
    state.remediationTimers.push(window.setTimeout(() => {
      writeOpsLine("[ACTION] Recycling edge workers...");
    }, 3000));
    state.remediationTimers.push(window.setTimeout(() => {
      state.incidentMode = "normal";
      setPrimaryGlow("#00f2fe");
      writeOpsLine("[SUCCESS] Traffic stabilized");
      fixButton.classList.remove("is-morphing");
      fixButton.classList.add("is-success");
      fixButton.querySelector(".action-text").textContent = "Stabilized";
      syncCurrentTelemetry();
      if (!isReplaying) renderLiveSnapshot();
      window.setTimeout(() => {
        fixButton.classList.remove("is-success");
        fixButton.querySelector(".action-text").textContent = "Fix This for Me";
      }, 1400);
    }, 4000));
  });
}

function initializeOpsTerminal() {
  if (state.opsTerminalBound) return;
  state.opsTerminalBound = true;

  closeOpsTerminal?.addEventListener("click", closeOpsTerminalShell);
  opsTerminal?.addEventListener("click", (event) => {
    if (event.target === opsTerminal || event.target.classList.contains("command-backdrop")) closeOpsTerminalShell();
  });
  opsTerminalInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = opsTerminalInput.value.trim();
    if (!value) return;
    runOpsCommand(value);
    opsTerminalInput.value = "";
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOpsTerminalShell();
  });
}

function postRenderInitialize() {
  routerViewContainer.style.opacity = "1";
  routerViewContainer.style.transform = "translateY(0)";
  initializeStaggeredLoad();
  initializeCardPhysics();
  initializeRollingNumbers();
  initializeActionMorph();
  updateEmergencyMode(getActiveSnapshot().logs);
  if (state.currentRoute === "#dashboard") {
    initializeTopologyMap();
    initializeChartScrubber();
    updateReplayControls();
    document.getElementById("replay-slider")?.addEventListener("input", handleReplaySliderInput);
    document.getElementById("global-filter-input")?.addEventListener("input", (event) => {
      state.globalFilter = event.target.value;
      applyGlobalFilter();
    });
    document.getElementById("latency-pod")?.addEventListener("click", () => {
      state.latencyDetailedView = !state.latencyDetailedView;
      renderLatencyPod(getActiveSnapshot());
    });
    document.getElementById("clear-logs-button")?.addEventListener("click", () => {
      clearLogs().catch((error) => {
        document.getElementById("incident-list").innerHTML = `<div class="incident-shell"><p class="incident-copy">${error.message}</p></div>`;
      });
    }, { once: true });
    updateDashboardView(getActiveSnapshot());
  }
  if (state.currentRoute === "#cluster") updateDeploymentsView(getActiveSnapshot());
  if (state.currentRoute === "#cluster") {
    document.getElementById("deploy-canary-button")?.addEventListener("click", startCanaryDeployment);
  }
  if (state.currentRoute === "#security") {
    document.getElementById("logs-filter-input")?.addEventListener("input", () => updateSecurityView(getActiveSnapshot().logs));
    initializeSecurityTopologyMap();
  }
  if (state.currentRoute === "#security") updateSecurityView(getActiveSnapshot().logs);
  if (state.currentRoute === "#upgrade") initializeUpgradeModule();
}

function handleRoute() {
  const nextRoute = getCurrentRoute();
  state.currentRoute = nextRoute;
  syncRouteLinks(nextRoute);
  if (state.topologyRaf) {
    cancelAnimationFrame(state.topologyRaf);
    state.topologyRaf = null;
  }

  routerViewContainer.style.transition = "opacity 180ms ease, transform 180ms ease";
  routerViewContainer.style.opacity = "0";
  routerViewContainer.style.transform = "translateY(8px)";

  window.setTimeout(() => {
    routerViewContainer.innerHTML = routes[nextRoute]();
    postRenderInitialize();
  }, 160);
}

document.addEventListener("mousemove", setGlobalMousePosition);
window.addEventListener("hashchange", handleRoute);

initializeGlassRipples();
initializeCommandPalette();
initializeSupportModule();
initializeOpsTerminal();

if (!window.location.hash) {
  window.location.hash = "#dashboard";
} else {
  handleRoute();
}

setPrimaryGlow("#00f2fe");
loadDashboard().catch(console.error);
state.dataPollHandle = window.setInterval(() => {
  loadDashboard().catch(console.error);
}, 3000);
syncCurrentTelemetry();
startTelemetryEngine();
