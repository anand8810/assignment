const apiBase = "/api";
let token = localStorage.getItem("att_token") || null;
let me = null;

function setToken(t) {
  token = t;
  if (t) localStorage.setItem("att_token", t);
  else localStorage.removeItem("att_token");
}

function authHeader() {
  return token ? { Authorization: "Bearer " + token } : {};
}

function qs(id) {
  return document.getElementById(id);
}

function showView(id) {
  ["authView", "employeeView", "adminView"].forEach((v) =>
    qs(v).classList.add("hidden")
  );
  qs(id).classList.remove("hidden");
  qs("userBadge").classList.toggle("hidden", id === "authView");
}

async function req(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign(
    { "Content-Type": "application/json" },
    opts.headers || {},
    authHeader()
  );
  if (opts.body && typeof opts.body !== "string")
    opts.body = JSON.stringify(opts.body);
  const res = await fetch(apiBase + path, opts);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

async function login() {
  const email = qs("email").value.trim();
  const password = qs("password").value;
  const r = await req("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (r && r.token) {
    setToken(r.token);
    me = r.user;
    qs("authMsg").textContent = "";
    qs("email").value = "";
    qs("password").value = "";
    afterLogin();
  } else {
    qs("authMsg").textContent = (r && r.message) || "Login failed";
  }
}

async function register() {
  const email = qs("email").value.trim();
  const password = qs("password").value;
  const r = await req("/auth/register", {
    method: "POST",
    body: { email, password },
  });
  qs("authMsg").textContent = (r && r.message) || "registered";
}

async function afterLogin() {
  if (!me) {
    const raw = parseJwt(token);
    me = { email: raw.email, role: raw.role };
  }
  qs("userBadge").textContent = me.email + " • " + me.role;
  if (me.role === "ADMIN") loadAdmin();
  else loadEmployee();
}

function parseJwt(t) {
  try {
    const p = t.split(".")[1];
    return JSON.parse(
      decodeURIComponent(
        atob(p)
          .split("")
          .map(function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      )
    );
  } catch (e) {
    return {};
  }
}

async function loadEmployee() {
  showView("employeeView");
  await refreshAttendanceStatus();
  await loadAssignedTasks();
  await loadTaskLogs();
}

async function loadAdmin() {
  showView("adminView");
  await loadAllTasksForAdmin();
  await loadAttendanceTable();
  const cfg = await req("/admin/config");
  if (cfg && cfg.autoHours) qs("autoHours").value = cfg.autoHours;
}

async function refreshAttendanceStatus() {
  const s = await req("/attendance/status");
  qs("attStatus").textContent = (s && s.message) || "";
}

async function loadAssignedTasks() {
  const tasks = await req("/tasks/assigned");
  const sel = qs("taskSelect");
  sel.innerHTML = '<option value="">-- Select task --</option>';
  if (Array.isArray(tasks))
    tasks.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.title;
      sel.appendChild(o);
    });
}

async function loadTaskLogs() {
  const logs = await req("/tasks/logs");
  const tbody = qs("taskLog").querySelector("tbody");
  tbody.innerHTML = "";
  if (Array.isArray(logs))
    logs.forEach((l) => {
      const tr = document.createElement("tr");
      const mins = calcMinutes(l.startTime, l.endTime);
      tr.innerHTML = `<td>${escapeHtml(l.taskTitle || "")}</td><td>${formatDate(
        l.startTime
      )}</td><td>${formatDate(l.endTime)}</td><td>${mins}</td>`;
      tbody.appendChild(tr);
    });
}

function calcMinutes(s, e) {
  if (!s) return "";
  const a = new Date(s);
  const b = e ? new Date(e) : new Date();
  return Math.max(0, Math.round((b - a) / 60000));
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString();
}

async function startTask() {
  const taskId = qs("taskSelect").value;
  if (!taskId) return;
  await req("/tasks/start", { method: "POST", body: { taskId } });
  await loadTaskLogs();
}

async function stopTask() {
  await req("/tasks/stop", { method: "POST" });
  await loadTaskLogs();
}

async function checkIn() {
  await req("/attendance/checkin", { method: "POST" });
  await refreshAttendanceStatus();
}

async function checkOut() {
  await req("/attendance/checkout", { method: "POST" });
  await refreshAttendanceStatus();
}

async function createTask() {
  const title = qs("newTaskTitle").value.trim();
  const desc = qs("newTaskDesc").value.trim();
  if (!title) return;
  await req("/tasks", { method: "POST", body: { title, description: desc } });
  qs("newTaskTitle").value = "";
  qs("newTaskDesc").value = "";
  await loadAllTasksForAdmin();
}

async function loadAllTasksForAdmin() {
  const tasks = await req("/tasks");
  const sel = qs("assignTaskSelect");
  sel.innerHTML = '<option value="">-- Select --</option>';
  if (Array.isArray(tasks))
    tasks.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.title;
      sel.appendChild(o);
    });
  await loadAssignedTasks();
}

async function assignTask() {
  const taskId = qs("assignTaskSelect").value;
  const email = qs("assignEmail").value.trim();
  if (!taskId || !email) return;
  await req(`/tasks/${taskId}/assign`, { method: "POST", body: { email } });
  qs("assignEmail").value = "";
  await loadAllTasksForAdmin();
}

async function loadAttendanceTable() {
  const rows = await req("/admin/attendance");
  const tbody = qs("attendanceTable").querySelector("tbody");
  tbody.innerHTML = "";
  if (Array.isArray(rows))
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.email)}</td><td>${formatDate(
        r.checkIn
      )}</td><td>${formatDate(r.checkOut)}</td><td>${escapeHtml(
        r.totalHours
      )}</td>`;
      tbody.appendChild(tr);
    });
}

async function saveAuto() {
  const hours = Number(qs("autoHours").value) || 9;
  await req("/admin/config", { method: "POST", body: { autoHours: hours } });
}

function logout() {
  setToken(null);
  me = null;
  showView("authView");
  qs("userBadge").textContent = "";
}

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}

document.addEventListener("click", (e) => {
  if (e.target.id === "loginBtn") login();
  if (e.target.id === "registerBtn") register();
  if (e.target.id === "startTaskBtn") startTask();
  if (e.target.id === "stopTaskBtn") stopTask();
  if (e.target.id === "checkInBtn") checkIn();
  if (e.target.id === "checkOutBtn") checkOut();
  if (e.target.id === "createTaskBtn") createTask();
  if (e.target.id === "assignBtn") assignTask();
  if (e.target.id === "saveAutoBtn") saveAuto();
  if (e.target.id === "empLogoutBtn" || e.target.id === "adminLogoutBtn")
    logout();
});

window.addEventListener("load", () => {
  if (token) {
    me = parseJwt(token);
    afterLogin();
  } else {
    showView("authView");
  }
});
