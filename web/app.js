const el = (id) => document.getElementById(id);
const statusEl = el("status");
const gridEl = el("grid");
const chipsEl = el("chips");
const queryInput = el("queryInput");
const toastEl = el("toast");

let queries = [];
let resultsByQuery = new Map();
let newKeysByQuery = new Map();
let notificationsEnabled = false;
let lastSnapshotKeySetByQuery = new Map();

const POLL_MS = Number(new URLSearchParams(location.search).get("pollMs") || 60000);

function loadNotificationsEnabled() {
  try {
    return localStorage.getItem("adurite.notificationsEnabled") === "1";
  } catch {
    return false;
  }
}

function setNotificationsEnabled(v) {
  notificationsEnabled = Boolean(v);
  try {
    localStorage.setItem("adurite.notificationsEnabled", notificationsEnabled ? "1" : "0");
  } catch {
    // ignore
  }
  el("notifyBtn").textContent = `Notifications: ${notificationsEnabled ? "On" : "Off"}`;
}

function toast(title, message) {
  toastEl.innerHTML = `<div class="t">${escapeHtml(title)}</div><div class="m">${escapeHtml(message)}</div>`;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2500);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderChips() {
  chipsEl.innerHTML = "";
  for (const q of queries) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(q)}</span>`;
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = "Remove";
    x.onclick = () => {
      queries = queries.filter((v) => v !== q);
      renderChips();
      rebuildResultsByQueryFromAll();
      renderGrid();
    };
    chip.appendChild(x);
    chipsEl.appendChild(chip);
  }
}

function normalizeQuery(q) {
  return String(q || "").trim();
}

function rebuildResultsByQueryFromAll() {
  const all = resultsByQuery.get("") || [];
  resultsByQuery = new Map([["", all]]);
  for (const q of queries) {
    const nq = normalizeQuery(q);
    const qn = nq.toLowerCase();
    const filtered = all.filter((it) => String(it.title || "").toLowerCase().includes(qn));
    resultsByQuery.set(nq, filtered);
  }
}

function renderGrid() {
  const list = queries.length ? queries.map(normalizeQuery) : [""];
  gridEl.innerHTML = "";
  for (const q of list) {
    const results = resultsByQuery.get(q) || [];
    const newKeys = newKeysByQuery.get(q) || new Set();

    const card = document.createElement("div");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "cardHeader";
    header.innerHTML = `<div class="q">${escapeHtml(q || "All listings")}</div><div class="pill">${results.length} results</div>`;
    card.appendChild(header);

    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:52%">Item</th>
          <th style="width:10%">Verified</th>
          <th style="width:20%">RAP</th>
          <th style="width:18%">Price</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    for (const r of results) {
      const key = `${r.title}__${r.rap}__${r.price}__${r.occurrence || 0}`;
      const tr = document.createElement("tr");
      if (newKeys.has(key)) tr.classList.add("new");
      tr.innerHTML = `
        <td>${escapeHtml(r.title)}</td>
        <td>${r.verified ? "✓" : "✕"}</td>
        <td>${escapeHtml(r.rap || "")}</td>
        <td class="price">${escapeHtml(r.price || r.rapPriceText || "")}</td>
      `;
      tbody.appendChild(tr);
    }
    card.appendChild(table);
    gridEl.appendChild(card);
  }
}

async function fetchSnapshot() {
  const res = await fetch(`/latest.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch latest.json failed: ${res.status}`);
  return await res.json();
}

function computeKeys(items) {
  const set = new Set();
  for (const it of items || []) {
    const key = `${it.title}__${it.rap}__${it.price}__${it.occurrence || 0}`;
    set.add(key);
  }
  return set;
}

function applySnapshot(snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const generatedAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null;

  // store "All" first
  resultsByQuery.set("", items);

  // rebuild per-query views from the all-list
  rebuildResultsByQueryFromAll();

  // new-item highlight + notifications (per query)
  const list = queries.length ? queries.map(normalizeQuery) : [""];
  for (const q of list) {
    const results = resultsByQuery.get(q) || [];
    const nextKeys = computeKeys(results);
    const prevKeys = lastSnapshotKeySetByQuery.get(q) || new Set();

    const newKeys = new Set();
    for (const k of nextKeys) if (!prevKeys.has(k)) newKeys.add(k);
    newKeysByQuery.set(q, newKeys);
    lastSnapshotKeySetByQuery.set(q, nextKeys);

    if (notificationsEnabled && Notification?.permission === "granted" && newKeys.size) {
      const firstNew = results.find((r) =>
        newKeys.has(`${r.title}__${r.rap}__${r.price}__${r.occurrence || 0}`)
      );
      if (firstNew) {
        const price = firstNew.price || firstNew.rapPriceText || "";
        new Notification("New Adurite listing", { body: `${firstNew.title} — ${price}` });
      }
    }
  }

  const timeText = generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt.toLocaleString() : "unknown time";
  statusEl.innerHTML = `<b>Last update:</b> ${escapeHtml(timeText)}${POLL_MS ? ` • <b>Auto:</b> ${Math.round(POLL_MS / 1000)}s` : ""}`;
  renderGrid();
}

let pollTimer = null;
let inFlight = null;

async function refreshNow({ toastOnError } = { toastOnError: true }) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const snapshot = await fetchSnapshot();
      applySnapshot(snapshot);
    } catch (e) {
      statusEl.textContent = "Failed to load latest.json";
      if (toastOnError) toast("Error", e?.message || String(e));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

el("addBtn").onclick = () => {
  const q = queryInput.value.trim();
  if (!q) return;
  if (!queries.includes(q)) queries.push(q);
  queryInput.value = "";
  renderChips();
  rebuildResultsByQueryFromAll();
  renderGrid();
};

queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("addBtn").click();
});

el("refreshBtn").onclick = () => refreshNow();

el("notifyBtn").onclick = async () => {
  if (!("Notification" in window)) {
    toast("Notifications", "Your browser doesn’t support notifications.");
    return;
  }
  if (!notificationsEnabled) {
    const p = await Notification.requestPermission();
    if (p !== "granted") {
      toast("Notifications", `Permission: ${p}`);
      setNotificationsEnabled(false);
      return;
    }
    setNotificationsEnabled(true);
    toast("Notifications", "Enabled");
  } else {
    setNotificationsEnabled(false);
    toast("Notifications", "Disabled");
  }
};

// init
setNotificationsEnabled(loadNotificationsEnabled());
refreshNow({ toastOnError: false });

if (POLL_MS > 0) {
  pollTimer = setInterval(() => {
    refreshNow({ toastOnError: false });
  }, POLL_MS);
}

