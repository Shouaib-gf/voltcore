const API = localStorage.getItem("vc_api") || "http://192.168.1.152:3000";
const SESSION_KEY = "vc_session";
const PREFS_KEY = "vc_preferences";
const PLAN_LIMITS = { Starter: 1, Professional: 5, Enterprise: 99 };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  token: null,
  user: null,
  vms: [],
  users: [],
  tasks: [],
  notifications: [],
  activities: [],
  infraHealth: null,
  filters: { search: "", status: "all", os: "all", owner: "all" },
  pendingPage: "dashboard",
  api: { vms: "idle", error: null },
  selectedPlan: { name: "Professional", price: "$79" },
  defaultSshKey: "",
  apiKey: "",
  pollTimer: null
};

const graphHistory = new Map();
const deployLogs = ["[ready] Waiting for deployment request..."];
const vmLogs = new Map();
let terminalSocket = null;

function osLabel(os) {
  const labels = { "ubuntu-22.04": "Ubuntu 22.04", "debian-12": "Debian 12" };
  return labels[os] || os || "Linux";
}

function normalizeVm(vm) {
  const ramGb = vm.ramMb ? Math.round(vm.ramMb / 1024) : vm.ram || 0;
  const owner = vm.userEmail || vm.owner || vm.user?.email || state.user?.email || "";
  return {
    id: Number(vm.vmId || vm.id || vm.vmid),
    owner,
    name: vm.name || vm.vmName || `vm-${vm.vmId || vm.id}`,
    os: osLabel(vm.os),
    rawOs: vm.os || "ubuntu-22.04",
    status: vm.status || "provisioning",
    cpu: Number(vm.cpuCores || vm.cpu || 0),
    ram: ramGb,
    disk: Number(vm.diskGb || vm.disk || 0),
    ip: vm.ip || "Pending IP",
    cpuLoad: Number(vm.cpu || vm.cpuLoad || 0),
    memLoad: vm.mem && vm.maxmem ? Math.round((vm.mem / vm.maxmem) * 100) : Number(vm.memLoad || 0),
    plan: vm.plan || state.user?.plan || "Professional",
    buildNumber: vm.buildNumber,
    buildUrl: vm.buildUrl,
    createdAt: vm.createdAt,
    expiresAt: vm.expiresAt,
    secondsRemaining: vm.secondsRemaining
  };
}

function timeAgo(value) {
  if (!value) return "Just now";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function leaseLabel(vm) {
  if (!vm.expiresAt) return "No lease set";
  const seconds = vm.secondsRemaining ?? Math.max(0, Math.round((new Date(vm.expiresAt).getTime() - Date.now()) / 1000));
  if (seconds <= 0) return "Expired";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${Math.max(1, hours)}h left`;
}

function saveSession() {
  if (!state.token || !state.user) return;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, user: state.user }));
}

function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!session?.token || !session?.user) return;
    state.token = session.token;
    state.user = session.user;
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (prefs.selectedPlan?.name) state.selectedPlan = prefs.selectedPlan;
    state.defaultSshKey = prefs.defaultSshKey || "";
    state.apiKey = prefs.apiKey || generateApiKey();
  } catch {
    state.apiKey = generateApiKey();
  }
  savePreferences();
}

function savePreferences() {
  localStorage.setItem(PREFS_KEY, JSON.stringify({
    selectedPlan: state.selectedPlan,
    defaultSshKey: state.defaultSshKey,
    apiKey: state.apiKey
  }));
}

function generateApiKey() {
  const bytes = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(12)) : Array.from({ length: 12 }, () => Math.floor(Math.random() * 256));
  return `vc_live_sk_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${API}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

function showToast(message) {
  const wrap = $("#toastWrap");
  if (!wrap) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  wrap.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function addEvent(title, detail, type = "success") {
  const entry = { type, read: false, title, detail, time: "Just now" };
  state.activities.unshift(entry);
  state.notifications.unshift(entry);
  state.activities.splice(0, state.activities.length, ...state.activities.slice(0, 8));
  state.notifications.splice(0, state.notifications.length, ...state.notifications.slice(0, 8));
  renderFeeds();
}

function normalizeNotification(item) {
  return {
    id: item._id || item.id,
    type: item.type || "info",
    read: Boolean(item.read),
    title: item.title,
    detail: item.detail,
    time: timeAgo(item.createdAt)
  };
}

function openModal(selector) {
  const modal = $(selector);
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModals() {
  $$(".modal-backdrop").forEach((modal) => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  });
}

function openAuth(tab = "login", page = "dashboard") {
  state.pendingPage = page;
  openModal("#authModal");
  switchAuthTab(tab);
}

function switchAuthTab(tab) {
  $$("[data-auth-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.authTab === tab));
  $("#loginForm")?.classList.toggle("is-active", tab === "login");
  $("#registerForm")?.classList.toggle("is-active", tab === "register");
}

function isSignedIn() {
  return Boolean(state.user && state.token);
}

function isAdmin() {
  return state.user?.role === "admin";
}

function updateHeader() {
  const signedIn = isSignedIn();
  $("#globalMessages")?.remove();
  $$("[data-open-auth]").forEach((button) => {
    button.style.display = signedIn ? "none" : "";
  });
  document.body.classList.toggle("is-signed-in", signedIn);
  document.body.classList.toggle("is-admin", signedIn && isAdmin());

  const name = state.user?.name || "Client";
  const role = state.user?.role || "user";
  if ($("#profileInitial")) {
    $("#profileInitial").textContent = signedIn && isAdmin() ? "♛" : "";
    $("#profileInitial").setAttribute("aria-label", signedIn && isAdmin() ? "Admin account" : "User account");
  }
  if ($("#profileName")) $("#profileName").textContent = name.split(" ")[0];
  if ($("#profileMenuName")) $("#profileMenuName").textContent = name;
  if ($("#profileMenuRole")) $("#profileMenuRole").textContent = "Workspace";
  $$('[data-page="admin"]').forEach((button) => {
    button.style.display = signedIn && isAdmin() ? "" : "none";
  });
}

async function login(email, password) {
  const data = await apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  state.token = data.token;
  state.user = data.user;
  saveSession();
  closeModals();
  updateHeader();
  showToast(`Signed in as ${state.user.name}.`);
  await loadUsers();
  await loadVms();
  await loadNotifications();
  await loadInfraHealth();
  showPage(state.pendingPage);
  startPolling();
}

async function register(name, email, password) {
  const data = await apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password, plan: state.selectedPlan.name })
  });
  state.token = data.token;
  state.user = data.user;
  saveSession();
  closeModals();
  updateHeader();
  showToast(`Welcome to VoltCore, ${state.user.name}.`);
  await loadUsers();
  await loadVms();
  await loadNotifications();
  await loadInfraHealth();
  showPage(state.pendingPage);
  startPolling();
}

function logout() {
  state.token = null;
  state.user = null;
  state.vms = [];
  state.notifications = [];
  state.activities = [];
  state.infraHealth = null;
  localStorage.removeItem(SESSION_KEY);
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  updateHeader();
  renderAll();
  showToast("Signed out.");
  showPage("home");
}

const protectedPages = new Set(["dashboard", "deploy", "admin"]);

function showPage(pageName) {
  if (protectedPages.has(pageName) && !isSignedIn()) {
    openAuth("login", pageName);
    showToast("Please sign in or register first.");
    return;
  }
  if (pageName === "admin" && !isAdmin()) {
    showToast("Admin role required.");
    pageName = "dashboard";
  }
  $$(".app-page").forEach((page) => page.classList.toggle("is-active", page.id === `page-${pageName}`));
  $$(".site-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.page === pageName));
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderAll();
}

async function loadVms() {
  if (!isSignedIn()) return;
  state.api.vms = "loading";
  state.api.error = null;
  renderAll();
  try {
    const rows = await apiRequest("/api/vms");
    state.vms = rows.filter((vm) => vm.status !== "deleted").map(normalizeVm);
    state.api.vms = "success";
  } catch (err) {
    state.api.vms = "error";
    state.api.error = err.message;
    showToast(`Failed to load VMs: ${err.message}`);
  }
  renderAll();
}

async function loadNotifications() {
  if (!isSignedIn()) return;
  try {
    const rows = await apiRequest("/api/notifications");
    const normalized = rows.map(normalizeNotification);
    state.notifications = normalized;
    state.activities = normalized.slice(0, 12);
  } catch {
    // Local notification state remains available if the API is temporarily offline.
  }
  renderFeeds();
}

async function loadInfraHealth() {
  if (!isAdmin()) return;
  try {
    state.infraHealth = await apiRequest("/api/infra/health");
  } catch (err) {
    state.infraHealth = { error: err.message, services: {} };
  }
  renderInfraHealth();
}

async function loadUsers() {
  if (!isAdmin()) {
    state.users = [];
    return;
  }
  try {
    state.users = await apiRequest("/api/auth/users");
  } catch (err) {
    showToast(`Failed to load users: ${err.message}`);
  }
}

async function refreshVmRuntime(vm) {
  if (!vm?.id || vm.status === "deleted") return;
  try {
    const status = await apiRequest(`/api/vms/${vm.id}/status`);
    vm.status = status.status || vm.status;
    vm.ip = status.ip || vm.ip;
    vm.cpuLoad = Number(status.cpu || 0);
    vm.memLoad = status.mem && status.maxmem ? Math.round((status.mem / status.maxmem) * 100) : vm.memLoad;
    vm.expiresAt = status.expiresAt || vm.expiresAt;
    vm.secondsRemaining = status.secondsRemaining ?? vm.secondsRemaining;
    if (status.uptime && vm.status === "running") pushVmLog(vm, `uptime ${Math.round(status.uptime / 60)}m`);
  } catch {
    // Proxmox may reject status while Jenkins is still provisioning; keep DB state visible.
  }
}

async function refreshVmMetrics(vm) {
  if (!vm?.id || vm.status === "deleted") return;
  try {
    const metrics = await apiRequest(`/api/vms/${vm.id}/metrics?timeframe=hour`);
    const points = metrics.data || [];
    if (!points.length) return;
    const cpu = points.map((point) => Math.max(0, Math.min(100, Number(point.cpu || 0))));
    const memMax = Math.max(...points.map((point) => Number(point.mem || 0)), 1);
    const mem = points.map((point) => Math.round((Number(point.mem || 0) / memMax) * 100));
    graphHistory.set(vm.id, { cpu: cpu.slice(-34), mem: mem.slice(-34) });
  } catch {
    // Metrics are best-effort; status still comes from Proxmox.
  }
}

async function refreshRuntime() {
  if (!isSignedIn() || !state.vms.length) return;
  await Promise.all(state.vms.slice(0, 8).map(refreshVmRuntime));
  state.vms.forEach((vm) => {
    const history = ensureHistory(vm);
    history.cpu.push(Math.round(vm.cpuLoad || 0));
    history.mem.push(Math.round(vm.memLoad || 0));
    while (history.cpu.length > 34) history.cpu.shift();
    while (history.mem.length > 34) history.mem.shift();
  });
  renderAll();
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    await pollBuilds();
    await refreshRuntime();
    await loadNotifications();
    if (isAdmin()) await loadInfraHealth();
  }, 8000);
}

async function activateSelectedPlan() {
  if (!isSignedIn()) {
    savePreferences();
    showToast(`${state.selectedPlan.name} selected for new registrations.`);
    return;
  }
  const data = await apiRequest("/api/auth/plan", {
    method: "PATCH",
    body: JSON.stringify({ plan: state.selectedPlan.name })
  });
  state.user = data.user;
  saveSession();
  await loadUsers();
  await loadNotifications();
  renderAll();
  showToast(`${state.selectedPlan.name} is active on your account.`);
}

async function pollBuilds() {
  const provisioning = state.vms.filter((vm) => vm.status === "provisioning" && vm.buildNumber);
  await Promise.all(provisioning.map(async (vm) => {
    try {
      const data = await apiRequest(`/api/vms/status/${vm.buildNumber}`);
      if (!data.building) {
        vm.status = data.status === "SUCCESS" ? "running" : "failed";
        if (data.ip) vm.ip = data.ip;
        addEvent(vm.status === "running" ? "VM ready" : "VM failed", `${vm.name} finished with ${data.status}.`, vm.status === "running" ? "success" : "warning");
      }
    } catch {
      // Keep polling on the next tick.
    }
  }));
}

function visibleVms() {
  if (!state.user) return [];
  return isAdmin() ? state.vms : state.vms.filter((vm) => vm.owner === state.user.email);
}

function applyFilters(vms) {
  return vms.filter((vm) => {
    const haystack = `${vm.name} ${vm.ip} ${vm.os} ${vm.owner}`.toLowerCase();
    return (!state.filters.search || haystack.includes(state.filters.search))
      && (state.filters.status === "all" || vm.status === state.filters.status)
      && (state.filters.os === "all" || vm.os === state.filters.os)
      && (state.filters.owner === "all" || vm.owner === state.filters.owner);
  });
}

function populateFilters() {
  const osFilter = $("#osFilter");
  const ownerFilter = $("#ownerFilter");
  if (!osFilter || !ownerFilter) return;
  const osOptions = [...new Set(state.vms.map((vm) => vm.os).filter(Boolean))];
  const ownerOptions = [...new Set(state.vms.map((vm) => vm.owner).filter(Boolean))];
  osFilter.innerHTML = `<option value="all">All OS</option>${osOptions.map((os) => `<option value="${os}">${os}</option>`).join("")}`;
  ownerFilter.innerHTML = `<option value="all">All owners</option>${ownerOptions.map((owner) => `<option value="${owner}">${owner}</option>`).join("")}`;
  osFilter.value = state.filters.os;
  ownerFilter.value = state.filters.owner;
}

function statusClass(status) {
  if (status === "running") return "on";
  if (status === "provisioning") return "warn";
  if (status === "failed") return "warn";
  return "off";
}

function statusLabel(status) {
  if (status === "running") return "Running";
  if (status === "provisioning") return "Provisioning";
  if (status === "failed") return "Failed";
  if (status === "deleted") return "Deleted";
  if (status === "poweroff") return "Powered Off";
  return "Stopped";
}

function ensureHistory(vm) {
  if (!graphHistory.has(vm.id)) {
    graphHistory.set(vm.id, { cpu: Array(18).fill(Number(vm.cpuLoad || 0)), mem: Array(18).fill(Number(vm.memLoad || 0)) });
  }
  return graphHistory.get(vm.id);
}

function pointsFrom(values) {
  const width = 260;
  const height = 96;
  const step = width / Math.max(1, values.length - 1);
  return values.map((value, index) => `${Math.round(index * step)},${Math.round(height - (value / 100) * height)}`).join(" ");
}

function graphCard(vm) {
  const history = ensureHistory(vm);
  return `
    <article class="graph-card">
      <h3>${vm.name}</h3>
      <div class="graph-grid">
        <div class="mini-graph">
          <h4>CPU Usage</h4>
          <svg class="stat-svg" viewBox="0 0 260 116" preserveAspectRatio="none">
            <line class="grid-line" x1="0" y1="18" x2="260" y2="18"></line>
            <line class="grid-line" x1="0" y1="58" x2="260" y2="58"></line>
            <line class="grid-line" x1="0" y1="98" x2="260" y2="98"></line>
            <polyline class="cpu-line" points="${pointsFrom(history.cpu)}"></polyline>
          </svg>
          <div class="graph-axis"><span>0%</span><span>${Math.round(vm.cpuLoad || 0)}%</span><span>100%</span></div>
        </div>
        <div class="mini-graph">
          <h4>Memory Usage</h4>
          <svg class="stat-svg" viewBox="0 0 260 116" preserveAspectRatio="none">
            <line class="grid-line" x1="0" y1="18" x2="260" y2="18"></line>
            <line class="grid-line" x1="0" y1="58" x2="260" y2="58"></line>
            <line class="grid-line" x1="0" y1="98" x2="260" y2="98"></line>
            <polyline class="mem-line" points="${pointsFrom(history.mem)}"></polyline>
          </svg>
          <div class="graph-axis"><span>0%</span><span>${Math.round(vm.memLoad || 0)}%</span><span>100%</span></div>
        </div>
      </div>
    </article>
  `;
}

function activeVmRow(vm) {
  const icon = vm.os.includes("Debian") ? "D" : "U";
  return `
    <div class="active-vm-row" data-open-vm="${vm.id}">
      <div class="active-vm-main">
        <i class="active-vm-icon">${icon}</i>
        <div><strong>${vm.name}</strong> <span>- ${vm.os} - ${leaseLabel(vm)}</span></div>
      </div>
      <b class="status ${statusClass(vm.status)}">${statusLabel(vm.status)}</b>
    </div>
  `;
}

function vmRow(vm) {
  const canStart = vm.status !== "running" && vm.status !== "provisioning";
  const canStop = vm.status === "running";
  return `
    <div class="studio-row" data-open-vm="${vm.id}">
      <span><strong>${vm.name}</strong><small>${vm.owner}</small></span>
      <b class="status ${statusClass(vm.status)}">${statusLabel(vm.status)}</b>
      <span>${vm.cpu} vCPU / ${vm.ram} GB RAM / ${vm.disk} GB SSD<br><small>${leaseLabel(vm)}</small></span>
      <span class="studio-actions">
        <button type="button" data-open-vm="${vm.id}">Details</button>
        <button type="button" data-action="terminal" data-id="${vm.id}">Terminal</button>
        <button type="button" data-action="start" data-id="${vm.id}" ${canStart ? "" : "disabled"}>Start</button>
        <button class="warn" type="button" data-action="stop" data-id="${vm.id}" ${canStop ? "" : "disabled"}>Stop</button>
        <button class="danger" type="button" data-action="delete" data-id="${vm.id}">Delete</button>
      </span>
    </div>
  `;
}

function formatNotice(item) {
  return `<article class="notice-item" data-read="${item.read}" data-type="${item.type || "success"}"><strong>${item.title}</strong><span>${item.detail}</span><span>${item.time}</span></article>`;
}

function formatActivity(item) {
  return `<article class="activity-item"><div><strong>${item.title}</strong><span>${item.detail}</span><span>${item.time}</span></div><button type="button">View</button></article>`;
}

function renderFeeds() {
  const noticeHtml = state.notifications.length ? state.notifications.slice(0, 5).map(formatNotice).join("") : `<article class="notice-item"><strong>No alerts</strong><span>Your workspace is quiet.</span></article>`;
  const activityHtml = state.activities.length ? state.activities.slice(0, 7).map(formatActivity).join("") : `<article class="activity-item"><strong>No activity</strong><span>Actions will appear here.</span></article>`;
  if ($("#rightNotifications")) $("#rightNotifications").innerHTML = noticeHtml;
  if ($("#notificationList")) $("#notificationList").innerHTML = noticeHtml;
  if ($("#notificationHistory")) $("#notificationHistory").innerHTML = state.notifications.map(formatNotice).join("");
  if ($("#activityFeed")) $("#activityFeed").innerHTML = activityHtml;
  if ($("#notificationCount")) $("#notificationCount").textContent = state.notifications.filter((item) => !item.read).length;
}

function healthBadge(service) {
  const ok = Boolean(service?.ok);
  return `<b class="status ${ok ? "on" : "warn"}">${ok ? "Online" : "Action needed"}</b>`;
}

function renderInfraHealth() {
  const panel = $("#admin-panel-infrastructure .admin-grid");
  if (!panel) return;
  const health = state.infraHealth;
  if (!health) {
    panel.innerHTML = `<article class="admin-card reveal"><span>Infrastructure</span><strong>Loading live health...</strong><p>Checking Proxmox, Jenkins, MinIO, MongoDB, and API status.</p></article>`;
    return;
  }
  const services = health.services || {};
  panel.innerHTML = `
    <article class="admin-card reveal"><span>Proxmox VE</span><strong>${healthBadge(services.proxmox)}</strong><p>${services.proxmox?.vmCount ?? 0} VMs visible on node pve.</p><div class="tenant-tags"><b>API</b><b>KVM</b><b>vmbr0</b></div></article>
    <article class="admin-card featured-admin reveal"><span>Automation</span><strong>${healthBadge(services.jenkins)}</strong><ol><li>Job: ${services.jenkins?.job || "voltcore-vm-provision"}</li><li>Buildable: ${services.jenkins?.buildable ? "yes" : "check Jenkins"}</li><li>Branch: codex/voltcore-react-app</li><li>Terraform state via MinIO</li></ol></article>
    <article class="admin-card reveal"><span>Storage + Database</span><strong>${healthBadge(services.minio)}</strong><p>Mongo records: ${services.mongo?.vmRecords ?? 0} VMs, ${services.mongo?.users ?? 0} users.</p><div class="tenant-tags"><b>MinIO</b><b>MongoDB</b><b>API</b></div></article>
  `;
}

function renderTasks() {
  const list = $("#taskList");
  if (!list) return;
  list.innerHTML = state.tasks.length ? state.tasks.map((task) => `<article class="task-item"><span>${task.name}</span><b>${task.status}</b></article>`).join("") : `<div class="state-card">No background tasks</div>`;
  if ($("#taskSummary")) $("#taskSummary").textContent = `${state.tasks.filter((task) => task.status === "running").length} running`;
}

function renderBilling(vms) {
  window.VoltCoreDashboard.renderBilling({ $, vms });
}

function renderSettings() {
  window.VoltCoreSettings.renderSettings({ $, state, updateSelectedPlanCards });
}

function renderDeployLogs() {
  if ($("#deployLogs")) $("#deployLogs").innerHTML = deployLogs.map((line) => `<div>${line}</div>`).join("");
}

function pushVmLog(vm, line) {
  if (!vmLogs.has(vm.id)) vmLogs.set(vm.id, []);
  vmLogs.get(vm.id).unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
  vmLogs.get(vm.id).splice(30);
}

function updatePlanLimit() {
  const btn = $("#deploySubmit");
  const msg = $("#planLimitMessage");
  if (!btn || !msg) return;
  const plan = state.user?.plan || state.selectedPlan.name;
  const limit = PLAN_LIMITS[plan] || 5;
  const count = visibleVms().filter((vm) => vm.status !== "deleted").length;
  const reached = count >= limit;
  btn.disabled = reached;
  msg.textContent = isSignedIn()
    ? (reached ? `${plan} plan limit reached (${count}/${limit}).` : `${plan} usage: ${count}/${limit} VMs`)
    : "Sign in to deploy a VM.";
}

function updateResourceUsage(avgCpu, avgRam, storageUsed) {
  $("#resourceDonut")?.style.setProperty("--meter", `${Math.round((avgCpu + avgRam) / 2)}%`);
  if ($("#cpuBar")) $("#cpuBar").style.width = `${avgCpu}%`;
  if ($("#ramBar")) $("#ramBar").style.width = `${avgRam}%`;
  if ($("#storageBar")) $("#storageBar").style.width = `${storageUsed}%`;
}

function planPriceValue() {
  return Number(String(state.selectedPlan.price || "$79").replace(/[^\d.]/g, "")) || 0;
}

function vmMonthlyCost(vm) {
  return window.VoltCoreDashboard.vmMonthlyCost(vm);
}

function currentMonthlySpend(vms) {
  return window.VoltCoreDashboard.currentMonthlySpend(state, vms, isSignedIn());
}

function renderSpendingChart(vms) {
  return window.VoltCoreDashboard.renderSpendingChart(state, vms);
}

function updateSelectedPlanCards() {
  window.VoltCoreDashboard.updateSelectedPlanCards({ $, $$, state });
}

function stateBlock(label) {
  if (state.api.vms === "loading") return `<div class="state-card"><div><div class="skeleton-line"></div><p>Loading ${label}...</p></div></div>`;
  if (state.api.error) return `<div class="state-card"><strong>Failed to load ${label}</strong><span>${state.api.error}</span></div>`;
  return "";
}

function renderAll() {
  populateFilters();
  const allVisible = visibleVms();
  const vms = applyFilters(allVisible);
  const running = allVisible.filter((vm) => vm.status === "running").length;
  const avgCpu = allVisible.length ? Math.round(allVisible.reduce((sum, vm) => sum + Number(vm.cpuLoad || 0), 0) / allVisible.length) : 0;
  const avgRam = allVisible.length ? Math.round(allVisible.reduce((sum, vm) => sum + Number(vm.memLoad || 0), 0) / allVisible.length) : 0;
  const storageUsed = Math.min(96, Math.round(allVisible.reduce((sum, vm) => sum + Number(vm.disk || 0), 0) / 8));
  const spendValue = currentMonthlySpend(allVisible);
  const spend = `$${spendValue}`;

  if ($("#workspaceGreeting")) $("#workspaceGreeting").textContent = `Good afternoon, ${state.user?.name?.split(" ")[0] || "client"}!`;
  if ($("#workspaceSubline")) $("#workspaceSubline").textContent = `You have ${allVisible.filter((vm) => vm.status === "provisioning").length} VMs pending deployment.`;
  if ($("#metricRunning")) $("#metricRunning").textContent = `${running} VMs`;
  if ($("#metricCpu")) $("#metricCpu").textContent = `${avgCpu}%`;
  if ($("#metricStorage")) $("#metricStorage").textContent = `${avgRam}%`;
  if ($("#metricSpend")) $("#metricSpend").textContent = spend;
  if ($("#billingSpend")) $("#billingSpend").textContent = spend;
  if ($("#spendingChart")) $("#spendingChart").innerHTML = renderSpendingChart(allVisible);
  updateResourceUsage(avgCpu, avgRam, storageUsed);

  const head = `<div class="studio-row head"><span>VM</span><span>Status</span><span>Plan</span><span>Actions</span></div>`;
  const empty = `<div class="empty-state"><div><strong>No virtual machines found</strong><span>Create a VM or adjust filters to see infrastructure here.</span></div></div>`;
  const stateHtml = stateBlock("VMs");
  if ($("#vmRows")) $("#vmRows").innerHTML = stateHtml || (vms.length ? vms.slice(0, 4).map(activeVmRow).join("") : empty);
  if ($("#vmRowsPanel")) $("#vmRowsPanel").innerHTML = stateHtml || (vms.length ? `${head}${vms.map(vmRow).join("")}` : empty);
  if ($("#vmGraphs")) $("#vmGraphs").innerHTML = vms.length ? vms.slice(0, 2).map(graphCard).join("") : "";
  if ($("#vmGraphsPanel")) $("#vmGraphsPanel").innerHTML = vms.length ? vms.map(graphCard).join("") : "";
  window.VoltCoreAdmin.renderAdmin({ $, state, spend, vmRow });
  renderInfraHealth();

  renderFeeds();
  renderTasks();
  renderBilling(allVisible);
  renderSettings();
  renderDeployLogs();
  updatePlanLimit();
}

async function updateVm(id, action) {
  const vm = state.vms.find((item) => item.id === Number(id));
  if (!vm) return;
  const endpoint = action === "delete" ? "destroy" : action;
  if (action === "terminal") {
    openTerminal(id);
    return;
  }
  if (!["start", "stop", "destroy"].includes(endpoint)) {
    showToast("This action is not available in the current backend.");
    return;
  }
  try {
    showToast(`${vm.name}: ${action} requested...`);
    await apiRequest(`/api/vms/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({ vmId: vm.id, vmName: vm.name })
    });
    if (action === "delete") {
      state.vms = state.vms.filter((item) => item.id !== vm.id);
      closeModals();
      addEvent("VM deleted", `${vm.name} removed from Proxmox.`);
    } else {
      vm.status = action === "start" ? "running" : "stopped";
      addEvent(`VM ${action}ed`, `${vm.name} is now ${vm.status}.`);
    }
    await loadVms();
    await refreshRuntime();
    renderAll();
    showToast(`${vm.name}: ${action} completed.`);
  } catch (err) {
    showToast(`${vm.name}: ${err.message}`);
  }
}

async function openVmDetails(id) {
  const vm = state.vms.find((item) => item.id === Number(id));
  if (!vm) return;
  openModal("#vmDetailsModal");
  if ($("#vmDetailName")) $("#vmDetailName").textContent = vm.name;
  if ($("#vmDetailInfo")) $("#vmDetailInfo").innerHTML = `<article><span>Status</span><strong>Loading live Proxmox stats...</strong></article>`;
  await refreshVmRuntime(vm);
  await refreshVmMetrics(vm);
  if ($("#vmDetailOwner")) $("#vmDetailOwner").textContent = vm.owner;
  if ($("#vmDetailName")) $("#vmDetailName").textContent = vm.name;
  const status = $("#vmDetailStatus");
  if (status) {
    status.className = `status ${statusClass(vm.status)}`;
    status.textContent = statusLabel(vm.status);
  }
  if ($("#vmDetailInfo")) {
    $("#vmDetailInfo").innerHTML = `
      <article><span>IP Address</span><strong>${vm.ip}</strong></article>
      <article><span>Operating System</span><strong>${vm.os}</strong></article>
      <article><span>VM ID</span><strong>${vm.id}</strong></article>
      <article><span>Lease</span><strong>${leaseLabel(vm)}</strong></article>
    `;
  }
  if ($("#vmDetailGraphs")) $("#vmDetailGraphs").innerHTML = graphCard(vm);
  if ($("#vmLogPanel")) $("#vmLogPanel").innerHTML = (vmLogs.get(vm.id) || ["No runtime log entries yet."]).map((line) => `<div>${line}</div>`).join("");
  if ($("#vmDetailActions")) {
    $("#vmDetailActions").innerHTML = `
      <button type="button" data-action="start" data-id="${vm.id}">Start</button>
      <button type="button" data-action="stop" data-id="${vm.id}">Stop</button>
      <button type="button" data-action="terminal" data-id="${vm.id}">Terminal</button>
      <button class="danger" type="button" data-action="delete" data-id="${vm.id}">Delete</button>
    `;
  }
}

function terminalUrl(vm) {
  const base = API.replace(/^http/, API.startsWith("https") ? "wss" : "ws");
  return `${base}/api/terminal?vmId=${encodeURIComponent(vm.id)}&token=${encodeURIComponent(state.token)}`;
}

function openTerminal(id) {
  const vm = state.vms.find((item) => item.id === Number(id));
  if (!vm) return;
  openVmDetails(id);
  const panel = $("#vmLogPanel");
  if (!panel) return;
  if (terminalSocket) terminalSocket.close();
  panel.innerHTML = `<div>Connecting terminal to ${vm.name}...</div>`;
  terminalSocket = new WebSocket(terminalUrl(vm));
  terminalSocket.addEventListener("message", (event) => {
    panel.innerHTML += `<div>${String(event.data).replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]))}</div>`;
    panel.scrollTop = panel.scrollHeight;
  });
  terminalSocket.addEventListener("close", () => {
    panel.innerHTML += `<div>[terminal closed]</div>`;
  });
  terminalSocket.addEventListener("error", () => {
    panel.innerHTML += `<div>[terminal error]</div>`;
  });
  if (!panel.dataset.boundInput) {
    panel.dataset.boundInput = "true";
    panel.tabIndex = 0;
    panel.addEventListener("keydown", (event) => {
      if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) return;
      if (event.key === "Enter") terminalSocket.send("\n");
      else if (event.key === "Backspace") terminalSocket.send("\b");
      else if (event.key.length === 1) terminalSocket.send(event.key);
      else return;
      event.preventDefault();
    });
  }
  panel.focus();
}

function deployCost() {
  const cpu = Number($("#vmCpu")?.value || 0);
  const ram = Number($("#vmRam")?.value || 0);
  const disk = Number($("#vmDisk")?.value || 0);
  const cost = Math.round(cpu * 8 + ram * 3 + disk * 0.12);
  if ($("#deployCost")) $("#deployCost").textContent = `$${cost}/mo`;
}

function bindSpecControl(rangeSelector, manualSelector) {
  const range = $(rangeSelector);
  const manual = $(manualSelector);
  if (!range || !manual) return;
  const min = Number(range.min);
  const max = Number(range.max);
  const sync = (source, target) => {
    const value = Math.max(min, Math.min(max, Number(source.value) || min));
    source.value = value;
    target.value = value;
    deployCost();
  };
  range.addEventListener("input", () => sync(range, manual));
  manual.addEventListener("input", () => sync(manual, range));
  manual.addEventListener("blur", () => sync(manual, range));
}

async function deployVm(event) {
  event.preventDefault();
  if (!isSignedIn()) {
    openAuth("login", "deploy");
    return;
  }
  const plan = state.user?.plan || state.selectedPlan.name;
  const limit = PLAN_LIMITS[plan] || 5;
  if (visibleVms().length >= limit) {
    showToast(`${plan} plan limit reached.`);
    return;
  }

  const name = ($("#vmName")?.value || "").trim().toLowerCase();
  const os = $("#vmOs")?.value || "ubuntu-22.04";
  const cpu = Number($("#vmCpu")?.value || 2);
  const ramGb = Number($("#vmRam")?.value || 2);
  const disk = Number($("#vmDisk")?.value || 40);
  const sshKey = ($("#vmKey")?.value || state.defaultSshKey || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) return showToast("VM name must use lowercase letters, numbers, and hyphens.");
  if (!sshKey.startsWith("ssh-")) return showToast("A valid SSH public key is required.");
  state.defaultSshKey = sshKey;
  savePreferences();

  const btn = $("#deploySubmit");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Deploying...";
  }
  const task = { name: `VM creation ${name}`, status: "running" };
  state.tasks.unshift(task);
  deployLogs.splice(0, deployLogs.length, `[${new Date().toLocaleTimeString()}] queued ${name}`, `[${new Date().toLocaleTimeString()}] calling Jenkins pipeline`);
  renderAll();

  try {
    const data = await apiRequest("/api/vms/deploy", {
      method: "POST",
      body: JSON.stringify({
        vmName: name,
        clientId: state.user.id,
        clientEmail: state.user.email,
        clientSshPubkey: sshKey,
        os,
        plan,
        cpuCores: cpu,
        ramMb: ramGb * 1024,
        diskGb: disk,
        leaseDays: plan === "Starter" ? 7 : 30
      })
    });
    const vm = normalizeVm(data.vm || data);
    state.vms.unshift(vm);
    task.status = "running";
    deployLogs.push(`[${new Date().toLocaleTimeString()}] Jenkins build ${vm.buildNumber || "started"}`);
    pushVmLog(vm, "deployment requested");
    addEvent("VM deploying", `${name} is provisioning through Jenkins.`);
    renderAll();
    showToast(`${name} deployment started.`);
    showPage("dashboard");
    await pollBuilds();
  } catch (err) {
    task.status = "failed";
    deployLogs.push(`[${new Date().toLocaleTimeString()}] failed: ${err.message}`);
    showToast(`Deployment failed: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Deploy VM";
    }
    renderAll();
  }
}

function setupEvents() {
  $$("[data-page]").forEach((element) => element.addEventListener("click", () => showPage(element.dataset.page)));
  $$("[data-open-auth]").forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.openAuth, "dashboard")));
  $("#profileButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    $("#profileMenu")?.classList.toggle("is-open");
  });
  $("#profileLogout")?.addEventListener("click", logout);
  $("#logoutBtn")?.addEventListener("click", logout);
  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
  $$(".modal-backdrop").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModals();
  }));
  $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => switchAuthTab(button.dataset.authTab)));

  $("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await login($("#loginEmail")?.value.trim(), $("#loginPassword")?.value || "");
    } catch (err) {
      showToast(err.message);
    }
  });

  $("#registerForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await register($("#registerName")?.value.trim(), $("#registerEmail")?.value.trim(), $("#registerPassword")?.value || "");
    } catch (err) {
      showToast(err.message);
    }
  });

  $$("[data-panel]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-panel]").forEach((item) => item.classList.remove("is-active"));
    $$(".client-panel").forEach((panel) => panel.classList.remove("is-active"));
    button.classList.add("is-active");
    $(`#panel-${button.dataset.panel}`)?.classList.add("is-active");
  }));

  $$("[data-admin-panel]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-admin-panel]").forEach((item) => item.classList.remove("is-active"));
    $$(".admin-panel").forEach((panel) => panel.classList.remove("is-active"));
    button.classList.add("is-active");
    $(`#admin-panel-${button.dataset.adminPanel}`)?.classList.add("is-active");
  }));

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.stopPropagation();
      if (!actionButton.disabled) updateVm(actionButton.dataset.id, actionButton.dataset.action);
      return;
    }
    const vmOpener = event.target.closest("[data-open-vm]");
    if (vmOpener && !event.target.closest(".studio-row.head")) openVmDetails(vmOpener.dataset.openVm);
  });

  $("#vmSearch")?.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    renderAll();
  });
  $("#globalSearchWrap")?.addEventListener("click", () => $("#vmSearch")?.focus());
  $("#statusFilter")?.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderAll();
  });
  $("#osFilter")?.addEventListener("change", (event) => {
    state.filters.os = event.target.value;
    renderAll();
  });
  $("#ownerFilter")?.addEventListener("change", (event) => {
    state.filters.owner = event.target.value;
    renderAll();
  });
  $("#notificationBell")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const dropdown = $("#notificationDropdown");
    dropdown?.classList.toggle("is-open");
    dropdown?.setAttribute("aria-hidden", dropdown.classList.contains("is-open") ? "false" : "true");
  });
  $("#clearNotifications")?.addEventListener("click", () => {
    state.notifications.splice(0);
    renderFeeds();
    apiRequest("/api/notifications", { method: "DELETE" }).catch(() => {});
  });
  $("#markNotificationsRead")?.addEventListener("click", () => {
    state.notifications.forEach((item) => { item.read = true; });
    renderFeeds();
    apiRequest("/api/notifications/read", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
  });
  $("#viewAllActivity")?.addEventListener("click", renderFeeds);
  $("#restartAllBtn")?.addEventListener("click", async () => {
    const stopped = visibleVms().filter((vm) => vm.status !== "running" && vm.status !== "provisioning");
    await Promise.all(stopped.map((vm) => updateVm(vm.id, "start")));
  });
  $("#deployForm")?.addEventListener("submit", deployVm);
  $("#paymentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await activateSelectedPlan();
    } catch (err) {
      showToast(`Subscription update failed: ${err.message}`);
    }
  });
  $("#quickPaymentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    closeModals();
    showPage("subscription");
  });
  $("#accessForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    openAuth("register", "dashboard");
  });
  $$(".select-plan").forEach((button) => button.addEventListener("click", () => {
    state.selectedPlan = { name: button.dataset.plan, price: button.dataset.price };
    savePreferences();
    updateSelectedPlanCards();
    showPage("subscription");
    $("#subscriptionLoader")?.classList.add("is-hidden");
    $("#planCheckout")?.classList.remove("is-hidden");
    $("#planCheckout")?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`${state.selectedPlan.name} selected.`);
  }));
  $("#saveSshKeyBtn")?.addEventListener("click", () => {
    const value = ($("#settingsSshKey")?.value || "").trim();
    if (!value.startsWith("ssh-")) return showToast("Paste a valid SSH public key first.");
    state.defaultSshKey = value;
    if ($("#vmKey")) $("#vmKey").value = value;
    savePreferences();
    showToast("Default SSH key saved.");
  });
  $("#settingsSshKey")?.addEventListener("input", (event) => {
    const value = event.target.value.trim();
    if (value.startsWith("ssh-")) {
      state.defaultSshKey = value;
      if ($("#vmKey")) $("#vmKey").value = value;
      savePreferences();
    }
  });
  $("#rotateApiKeyBtn")?.addEventListener("click", () => {
    state.apiKey = generateApiKey();
    savePreferences();
    renderSettings();
    showToast("API key rotated.");
  });
  $("#syncAdminBtn")?.addEventListener("click", async () => {
    await loadVms();
    await loadInfraHealth();
    showToast("Admin VM records refreshed.");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });
}

function setupVisuals() {
  const balanceValue = $("#balanceValue");
  if (balanceValue) {
    setInterval(() => {
      balanceValue.textContent = `${visibleVms().filter((vm) => vm.status === "running").length} Online`;
    }, 3200);
  }

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px" });
    $$(".reveal").forEach((element) => revealObserver.observe(element));
  }
}

async function initialize() {
  loadPreferences();
  setupVisuals();
  setupEvents();
  bindSpecControl("#vmCpu", "#vmCpuManual");
  bindSpecControl("#vmRam", "#vmRamManual");
  bindSpecControl("#vmDisk", "#vmDiskManual");
  deployCost();
  loadSession();
  updateHeader();
  renderFeeds();
  renderAll();
  if (isSignedIn()) {
    try {
      const data = await apiRequest("/api/auth/me");
      state.user = data.user;
      saveSession();
      await loadUsers();
      await loadVms();
      await loadNotifications();
      await loadInfraHealth();
      startPolling();
    } catch {
      logout();
    }
  }
}

initialize();
