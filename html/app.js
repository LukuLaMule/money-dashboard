/* ============================================================
   money.luku.fr — dashboard read-only PEA/CTO
   Données : data.json (aucune écriture côté client)
   ============================================================ */

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EUR2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} %`;

const COLORS = ["#39ff14", "#00e5ff", "#ff2e97", "#ffd000", "#ff7b00", "#9b5cff", "#ff2b2b"];
let DATA = null;
let currentAccount = "all";
let charts = {};

/* ---------- number pop-in (transitions-dev) ---------- */
function setDigits(group, str) {
  group.classList.remove("is-animating");
  group.replaceChildren();
  const chars = str.split("");
  chars.forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "t-digit";
    span.textContent = ch;
    if (i === chars.length - 2) span.dataset.stagger = "1";
    else if (i === chars.length - 1) span.dataset.stagger = "2";
    group.appendChild(span);
  });
  void group.offsetHeight; // reflow → rejoue l'anim
  group.classList.add("is-animating");
}

/* ---------- helpers données ---------- */
const accFilter = (row) => currentAccount === "all" || row.account === currentAccount;

function monthsSorted() {
  return [...new Set(DATA.snapshots.map((s) => s.date))].sort();
}

function seriesFor(field) {
  // somme par date sur les comptes filtrés
  const dates = monthsSorted();
  return dates.map((d) => {
    const rows = DATA.snapshots.filter((s) => s.date === d && accFilter(s));
    return rows.reduce((acc, r) => acc + (r[field] || 0), 0);
  });
}

function computeKpis() {
  const dates = monthsSorted();
  const lastDate = dates[dates.length - 1];
  const firstOfYear = dates.find((d) => d.startsWith(lastDate.slice(0, 4)));

  const sumAt = (date, field) =>
    DATA.snapshots.filter((s) => s.date === date && accFilter(s)).reduce((a, r) => a + r[field], 0);

  const value = sumAt(lastDate, "value");
  const invested = sumAt(lastDate, "invested");
  const gain = value - invested;
  const gainPct = invested ? (gain / invested) * 100 : 0;

  const valYearStart = sumAt(firstOfYear, "value");
  const ytd = valYearStart ? ((value - valYearStart) / valYearStart) * 100 : 0;

  const div = DATA.dividends.filter(accFilter).reduce((a, r) => a + r.amount, 0);

  return { value, invested, gain, gainPct, ytd, div };
}

function renderKpis() {
  const k = computeKpis();
  const set = (sel, txt) => setDigits(document.querySelector(`[data-kpi="${sel}"] .kpi-value`), txt);
  set("value", EUR.format(k.value));
  set("gain", `${k.gain >= 0 ? "+" : ""}${EUR.format(k.gain)}`);
  set("div", EUR.format(k.div));
  set("perf", PCT(k.ytd));

  const sub = (name, html, cls) => {
    const el = document.querySelector(`[data-sub="${name}"]`);
    el.innerHTML = html; el.className = `kpi-sub ${cls || ""}`;
  };
  sub("value", `investi ${EUR.format(k.invested)}`, "");
  sub("gain", PCT(k.gainPct), k.gain >= 0 ? "pos" : "neg");
  sub("div", "encaissés", "");
  sub("perf", "depuis 1er janv.", k.ytd >= 0 ? "pos" : "neg");
}

/* ---------- charts ---------- */
const gridColor = "rgba(255,255,255,.06)";
const tickColor = "#8a9a82";
Chart.defaults.font.family = "'Russo One', sans-serif";
Chart.defaults.color = tickColor;

function destroy(name) { if (charts[name]) { charts[name].destroy(); delete charts[name]; } }

function renderPerf() {
  destroy("perf");
  const labels = monthsSorted().map((d) => d.slice(0, 7));
  const value = seriesFor("value");
  const invested = seriesFor("invested");
  const ctx = document.getElementById("perfChart");
  charts.perf = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Valorisation", data: value, borderColor: "#39ff14", backgroundColor: "rgba(57,255,20,.12)",
          fill: true, tension: .35, borderWidth: 3, pointRadius: 0, pointHoverRadius: 5,
        },
        {
          label: "Investi", data: invested, borderColor: "#ffd000", borderDash: [6, 5],
          fill: false, tension: .25, borderWidth: 2, pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 14 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${EUR.format(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: gridColor } },
        y: { grid: { color: gridColor }, ticks: { callback: (v) => EUR.format(v) } },
      },
    },
  });
}

function renderDiv() {
  destroy("div");
  const byMonth = {};
  DATA.dividends.filter(accFilter).forEach((d) => {
    const m = d.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + d.amount;
  });
  const labels = Object.keys(byMonth).sort();
  charts.div = new Chart(document.getElementById("divChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Dividendes", data: labels.map((l) => byMonth[l]),
        backgroundColor: "#00e5ff", borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => EUR2.format(c.parsed.y) } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: gridColor }, ticks: { callback: (v) => EUR.format(v) } } },
    },
  });
}

function renderAlloc() {
  destroy("alloc");
  const pos = DATA.positions.filter(accFilter);
  const labels = pos.map((p) => p.ticker);
  const data = pos.map((p) => p.shares * p.last);
  charts.alloc = new Chart(document.getElementById("allocChart"), {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: COLORS, borderColor: "#0e1411", borderWidth: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "58%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, font: { size: 10 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${EUR.format(c.parsed)}` } },
      },
    },
  });
}

function renderTable() {
  const tbody = document.querySelector("#positions tbody");
  tbody.innerHTML = "";
  const accLabel = Object.fromEntries(DATA.accounts.map((a) => [a.id, a.label]));
  DATA.positions.filter(accFilter)
    .map((p) => ({ ...p, value: p.shares * p.last, gain: p.shares * (p.last - p.pru) }))
    .sort((a, b) => b.value - a.value)
    .forEach((p) => {
      const pct = ((p.last - p.pru) / p.pru) * 100;
      const cls = p.gain >= 0 ? "pos" : "neg";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${p.ticker}</strong></td>
        <td>${p.label}</td>
        <td><span class="badge ${p.account}">${accLabel[p.account] || p.account}</span></td>
        <td class="num">${p.shares}</td>
        <td class="num">${EUR2.format(p.pru)}</td>
        <td class="num">${EUR2.format(p.last)}</td>
        <td class="num">${EUR.format(p.value)}</td>
        <td class="num ${cls}">${p.gain >= 0 ? "+" : ""}${EUR.format(p.gain)} (${PCT(pct)})</td>`;
      tbody.appendChild(tr);
    });
}

function renderAll() {
  renderKpis();
  renderPerf();
  renderDiv();
  renderAlloc();
  renderTable();
}

/* ---------- tabs sliding (transitions-dev) ---------- */
function wireTabs() {
  const bar = document.querySelector(".t-tabs");
  const pill = bar.querySelector(".t-tabs-pill");
  const tabs = [...bar.querySelectorAll(".t-tab")];
  function moveTo(tab, animate) {
    if (!animate) {
      const prev = pill.style.transition;
      pill.style.transition = "none";
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = prev;
    } else {
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
    }
  }
  const active = () => tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.setAttribute("aria-selected", t === tab ? "true" : "false"));
      moveTo(tab, true);
      currentAccount = tab.dataset.acc;
      renderAll();
    });
  });
  requestAnimationFrame(() => moveTo(active(), false));
  window.addEventListener("resize", () => moveTo(active(), false));
}

/* ============================================================
   MLG MODE — hitmarkers, pluie, airhorn, screen shake
   ============================================================ */
let audioCtx = null;
function airhorn() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [0, 0.18, 0.36].forEach((t) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(415, now + t);
      o.frequency.linearRampToValueAtTime(440, now + t + 0.15);
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.15);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + t); o.stop(now + t + 0.16);
    });
  } catch (e) { /* audio bloqué : pas grave */ }
}

function hitmarker(x, y) {
  const layer = document.getElementById("hitmarker-layer");
  const m = document.createElement("div");
  m.className = "hitmarker";
  m.textContent = "✛";
  m.style.left = x + "px";
  m.style.top = y + "px";
  layer.appendChild(m);
  setTimeout(() => m.remove(), 360);
}

const RAIN = ["🌭", "🥤", "🔥", "💯", "🎯", "🕶️", "💸", "🤑", "👌", "🌿"];
let rainTimer = null;
function startRain() {
  const layer = document.getElementById("rain-layer");
  rainTimer = setInterval(() => {
    const d = document.createElement("div");
    d.className = "drop";
    d.textContent = RAIN[(Math.random() * RAIN.length) | 0];
    d.style.left = Math.random() * 100 + "vw";
    d.style.fontSize = 1.4 + Math.random() * 2 + "rem";
    const dur = 3 + Math.random() * 3;
    d.style.animationDuration = dur + "s";
    layer.appendChild(d);
    setTimeout(() => d.remove(), dur * 1000 + 200);
  }, 220);
}
function stopRain() {
  clearInterval(rainTimer); rainTimer = null;
  setTimeout(() => { document.getElementById("rain-layer").innerHTML = ""; }, 4000);
}

function wireMlg() {
  // hitmarker au clic partout
  document.addEventListener("pointerdown", (e) => {
    hitmarker(e.clientX, e.clientY);
    if (document.body.classList.contains("mlg")) airhorn();
  });

  const btn = document.getElementById("mlg-toggle");
  btn.addEventListener("click", () => {
    const on = document.body.classList.toggle("mlg");
    if (on) {
      airhorn(); startRain();
      document.body.classList.add("shake");
      setTimeout(() => document.body.classList.remove("shake"), 900);
    } else {
      stopRain();
    }
  });
}

/* ============================================================
   boot
   ============================================================ */
async function boot() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    DATA = await res.json();
  } catch (e) {
    document.querySelector(".wrap").innerHTML =
      `<div class="card"><h2 class="card-title">⚠️ data.json introuvable</h2>
       <p class="muted">Ajoute ton fichier de données. Voir README.md.</p></div>`;
    return;
  }
  document.getElementById("lastUpdate").textContent =
    new Date(DATA.lastUpdate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  wireTabs();
  wireMlg();
  renderAll();
}

document.addEventListener("DOMContentLoaded", boot);
