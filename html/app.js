/* ============================================================
   money.luku.fr — dashboard read-only PEA/CTO
   ============================================================ */

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EUR2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} %`;

const COLORS = ["#39ff14", "#00e5ff", "#ff2e97", "#ffd000", "#ff7b00", "#9b5cff", "#ff2b2b", "#1ce8b5", "#ff5cf0", "#b0ff3c"];
let DATA = null;
let currentAccount = "all";
let currentRange = 0; // mois ; 0 = max
let charts = {};

/* ---------- pays / zone par ISIN ---------- */
const ZONE_BY_ISIN = {
  // ETF : on classe par exposition réelle, pas par domicile
  FR0013412285: "🇺🇸 États-Unis", FR0010755611: "🇺🇸 États-Unis",
  LU2655993207: "🌍 Monde", FR0013411980: "🇯🇵 Japon", FR0013412020: "🌏 Émergents",
};
const COUNTRY_BY_PREFIX = {
  FR: "🇫🇷 France", NL: "🇳🇱 Pays-Bas", DE: "🇩🇪 Allemagne", US: "🇺🇸 États-Unis",
  GB: "🇬🇧 Royaume-Uni", IT: "🇮🇹 Italie", ES: "🇪🇸 Espagne", LU: "🇱🇺 Luxembourg",
  CH: "🇨🇭 Suisse", JP: "🇯🇵 Japon", KY: "🌏 Îles Caïmans", AU: "🇦🇺 Australie",
  CA: "🇨🇦 Canada", XF: "₿ Crypto",
};
function zoneOf(p) {
  if (p.isin && ZONE_BY_ISIN[p.isin]) return ZONE_BY_ISIN[p.isin];
  if (p.isin) return COUNTRY_BY_PREFIX[p.isin.slice(0, 2)] || "🌐 Autre";
  return "🌐 Autre";
}

/* ---------- valeur / +/- value d'une position (gère 2 formes) ----------
   - PEA : shares + pru + last  → value = shares*last
   - CTO : value + gainPct (+ cost) saisis manuellement (qté/pru/cours inconnus) */
const posValue = (p) => (p.value != null ? p.value : p.shares * p.last);
const posGain = (p) => {
  if (p.value != null) {
    const cost = p.cost != null ? p.cost : p.value / (1 + (p.gainPct || 0) / 100);
    return p.value - cost;
  }
  return p.shares * (p.last - p.pru);
};
const posGainPct = (p) => {
  if (p.value != null) return p.gainPct || 0;
  return p.pru ? ((p.last - p.pru) / p.pru) * 100 : 0;
};

/* ---------- number pop-in ---------- */
function setDigits(group, str) {
  group.classList.remove("is-animating");
  group.replaceChildren();
  str.split("").forEach((ch, i, arr) => {
    const span = document.createElement("span");
    span.className = "t-digit"; span.textContent = ch;
    if (i === arr.length - 2) span.dataset.stagger = "1";
    else if (i === arr.length - 1) span.dataset.stagger = "2";
    group.appendChild(span);
  });
  void group.offsetHeight;
  group.classList.add("is-animating");
}

/* ---------- helpers ---------- */
const accFilter = (row) => currentAccount === "all" || row.account === currentAccount;
const monthsSorted = () => [...new Set(DATA.snapshots.map((s) => s.date))].sort();

function rangeCutoff() {
  const months = monthsSorted();
  if (!currentRange || !months.length) return null;
  const idx = Math.max(0, months.length - currentRange);
  return months[idx];
}
function inRange(date) {
  const c = rangeCutoff();
  return !c || date >= c;
}

function seriesFor(field) {
  return monthsSorted().filter(inRange).map((d) => {
    const rows = DATA.snapshots.filter((s) => s.date === d && accFilter(s) && s[field] != null);
    return rows.length ? rows.reduce((a, r) => a + r[field], 0) : null;
  });
}

function computeKpis() {
  const dates = monthsSorted();
  const last = dates[dates.length - 1];
  const sumAt = (date, f) => DATA.snapshots.filter((s) => s.date === date && accFilter(s) && s[f] != null).reduce((a, r) => a + r[f], 0);
  const value = sumAt(last, "value") || sumAt(last, "invested");
  const invested = sumAt(last, "invested");
  const gain = value - invested;
  const gainPct = invested ? (gain / invested) * 100 : 0;
  // perf sur la plage sélectionnée
  const visible = dates.filter(inRange);
  const firstV = visible.find((d) => sumAt(d, "value")) || visible[0];
  const v0 = sumAt(firstV, "value") || sumAt(firstV, "invested");
  const perf = v0 ? ((value - v0) / v0) * 100 : 0;
  const div = DATA.dividends.filter(accFilter).reduce((a, r) => a + r.amount, 0);
  return { value, invested, gain, gainPct, perf, div };
}

function renderKpis() {
  const k = computeKpis();
  const set = (s, t) => setDigits(document.querySelector(`[data-kpi="${s}"] .kpi-value`), t);
  set("value", EUR.format(k.value));
  set("gain", `${k.gain >= 0 ? "+" : ""}${EUR.format(k.gain)}`);
  set("div", EUR.format(k.div));
  set("perf", PCT(k.perf));
  const sub = (n, h, c) => { const el = document.querySelector(`[data-sub="${n}"]`); el.innerHTML = h; el.className = `kpi-sub ${c || ""}`; };
  sub("value", `investi ${EUR.format(k.invested)}`, "");
  sub("gain", PCT(k.gainPct), k.gain >= 0 ? "pos" : "neg");
  sub("div", "encaissés (total)", "");
  sub("perf", "sur la période", k.perf >= 0 ? "pos" : "neg");
}

/* ---------- charts (couleurs pilotées par le thème CSS) ---------- */
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const withAlpha = (hex, aa) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex);
function palette() {
  return {
    neon: cssVar("--neon") || "#39ff14", cyan: cssVar("--cyan") || "#00e5ff",
    gold: cssVar("--gold") || "#ffd000", red: cssVar("--red") || "#ff2b2b",
    grid: cssVar("--border") || "rgba(255,255,255,.08)", tick: cssVar("--muted") || "#8a9a82",
  };
}
Chart.defaults.font.family = "'Inter','Russo One',sans-serif";
const destroy = (n) => { if (charts[n]) { charts[n].destroy(); delete charts[n]; } };

function renderPerf() {
  destroy("perf");
  const p = palette(); Chart.defaults.color = p.tick;
  const labels = monthsSorted().filter(inRange).map((d) => d.slice(0, 7));
  charts.perf = new Chart(document.getElementById("perfChart"), {
    type: "line",
    data: { labels, datasets: [
      { label: "Valorisation", data: seriesFor("value"), borderColor: p.neon, backgroundColor: withAlpha(p.neon, "20"), fill: true, tension: .35, borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, spanGaps: true },
      { label: "Investi", data: seriesFor("invested"), borderColor: p.gold, borderDash: [6, 5], fill: false, tension: .25, borderWidth: 2, pointRadius: 0, spanGaps: true },
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 14 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? "—" : EUR.format(c.parsed.y)}` } } },
      scales: { x: { grid: { color: p.grid } }, y: { grid: { color: p.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
  });
}

function renderDiv() {
  destroy("div");
  const p = palette(); Chart.defaults.color = p.tick;
  const byMonth = {};
  DATA.dividends.filter(accFilter).filter((d) => inRange(d.date.slice(0, 7) + "-01")).forEach((d) => {
    const m = d.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + d.amount;
  });
  const labels = Object.keys(byMonth).sort();
  charts.div = new Chart(document.getElementById("divChart"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Dividendes", data: labels.map((l) => byMonth[l]), backgroundColor: p.cyan, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => EUR2.format(c.parsed.y) } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: p.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
  });
}

function doughnut(canvasId, labels, data) {
  const legendPos = window.innerWidth <= 768 ? "bottom" : "right";
  return new Chart(document.getElementById(canvasId), {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: COLORS, borderColor: "#0e1411", borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "58%",
      plugins: { legend: { position: legendPos, labels: { boxWidth: 12, font: { size: 10 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${EUR.format(c.parsed)} (${(c.parsed / c.dataset.data.reduce((a, b) => a + b, 0) * 100).toFixed(0)}%)` } } } },
  });
}

function renderAlloc() {
  destroy("alloc");
  const pos = DATA.positions.filter(accFilter);
  charts.alloc = doughnut("allocChart", pos.map((p) => p.ticker), pos.map(posValue));
}

function renderCountry() {
  destroy("country");
  const byZone = {};
  DATA.positions.filter(accFilter).forEach((p) => { const z = zoneOf(p); byZone[z] = (byZone[z] || 0) + posValue(p); });
  const entries = Object.entries(byZone).sort((a, b) => b[1] - a[1]);
  charts.country = doughnut("countryChart", entries.map((e) => e[0]), entries.map((e) => e[1]));
}

function renderTable() {
  const tbody = document.querySelector("#positions tbody");
  tbody.innerHTML = "";
  const accLabel = Object.fromEntries(DATA.accounts.map((a) => [a.id, a.label]));
  DATA.positions.filter(accFilter)
    .map((p) => ({ ...p, _val: posValue(p), _gain: posGain(p), _pct: posGainPct(p) }))
    .sort((a, b) => b._val - a._val)
    .forEach((p) => {
      const cls = p._gain >= 0 ? "pos" : "neg";
      const dash = '<span class="muted">—</span>';
      const qty = p.shares != null ? (+p.shares).toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : dash;
      const pru = p.pru != null ? EUR2.format(p.pru) : dash;
      const last = p.last != null ? EUR2.format(p.last) : dash;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${p.ticker}</strong></td>
        <td>${p.label}</td>
        <td><span class="badge ${p.account}">${accLabel[p.account] || p.account}</span></td>
        <td>${zoneOf(p)}</td>
        <td class="num">${qty}</td>
        <td class="num">${pru}</td>
        <td class="num">${last}</td>
        <td class="num">${EUR.format(p._val)}</td>
        <td class="num ${cls}">${p._gain >= 0 ? "+" : ""}${EUR.format(p._gain)} (${PCT(p._pct)})</td>`;
      tbody.appendChild(tr);
    });
}

/* dividendes à venir : projection des 12 derniers mois sur l'année suivante,
   uniquement pour les lignes ENCORE DÉTENUES (filtre par ISIN/ticker des positions) */
function renderUpcoming() {
  const tbody = document.querySelector("#upcoming tbody");
  tbody.innerHTML = "";
  const today = new Date();
  const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1);
  // identités des positions actuellement détenues (du/des compte(s) filtré(s))
  const heldIsin = new Set(DATA.positions.filter(accFilter).map((p) => p.isin).filter(Boolean));
  const heldTk = new Set(DATA.positions.filter(accFilter).map((p) => p.ticker));
  const stillHeld = (d) => (d.isin ? heldIsin.has(d.isin) : heldTk.has(d.ticker));
  const proj = DATA.dividends.filter(accFilter)
    .filter((d) => new Date(d.date) >= oneYearAgo)
    .filter(stillHeld)
    .map((d) => {
      const nd = new Date(d.date); nd.setFullYear(nd.getFullYear() + 1);
      return { date: nd, month: nd.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), ticker: d.ticker, label: d.label, amount: d.amount };
    })
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date - b.date);
  if (!proj.length) { tbody.innerHTML = `<tr><td colspan="4" class="muted">Pas assez d'historique pour estimer.</td></tr>`; return; }
  proj.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.month}</td><td><strong>${d.ticker}</strong></td><td>${d.label}</td><td class="num">${EUR2.format(d.amount)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderAll() {
  renderKpis(); renderPerf(); renderDiv(); renderAlloc(); renderCountry(); renderTable(); renderUpcoming();
}

/* news éco : chargées depuis news.json (généré côté serveur depuis un flux RSS) */
async function renderNews() {
  const box = document.getElementById("news");
  try {
    const n = await (await fetch("news.json", { cache: "no-store" })).json();
    if (n.source) document.getElementById("news-src").textContent = "— " + n.source;
    const items = (n.items || []).slice(0, 15);
    if (!items.length) { box.innerHTML = `<p class="muted" style="padding:10px">Aucune actu pour le moment.</p>`; return; }
    box.innerHTML = items.map((it) => `
      <a class="news-item" href="${it.link}" target="_blank" rel="noopener noreferrer">
        <span class="news-src">${it.source || ""}</span>
        <span class="news-title">${it.title}</span>
        <span class="news-date">${it.date ? new Date(it.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </a>`).join("");
  } catch (e) {
    box.innerHTML = `<p class="muted" style="padding:10px">Flux news indisponible.</p>`;
  }
}

/* ---------- tabs (génériques pour les deux barres) ---------- */
function wireTabBar(sel, onSelect) {
  const bar = document.querySelector(sel);
  const pill = bar.querySelector(".t-tabs-pill");
  const tabs = [...bar.querySelectorAll(".t-tab")];
  function moveTo(tab, animate) {
    if (!animate) { const prev = pill.style.transition; pill.style.transition = "none"; pill.style.transform = `translateX(${tab.offsetLeft}px)`; pill.style.width = `${tab.offsetWidth}px`; void pill.offsetWidth; pill.style.transition = prev; }
    else { pill.style.transform = `translateX(${tab.offsetLeft}px)`; pill.style.width = `${tab.offsetWidth}px`; }
  }
  const active = () => tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-selected", t === tab ? "true" : "false"));
    moveTo(tab, true); onSelect(tab); renderAll();
  }));
  requestAnimationFrame(() => moveTo(active(), false));
  window.addEventListener("resize", () => moveTo(active(), false));
}

/* ============================================================
   MLG MODE
   ============================================================ */
let audioCtx = null;
function airhorn() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [0, 0.18, 0.36].forEach((t) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(415, now + t); o.frequency.linearRampToValueAtTime(440, now + t + 0.15);
      g.gain.setValueAtTime(0.0001, now + t); g.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.15);
      o.connect(g).connect(audioCtx.destination); o.start(now + t); o.stop(now + t + 0.16);
    });
  } catch (e) {}
}
function hitmarker(x, y) {
  const m = document.createElement("div"); m.className = "hitmarker"; m.textContent = "✛";
  m.style.left = x + "px"; m.style.top = y + "px";
  document.getElementById("hitmarker-layer").appendChild(m);
  setTimeout(() => m.remove(), 360);
}
const RAIN = ["🌭", "🥤", "🔥", "💯", "🎯", "🕶️", "💸", "🤑", "👌", "🌿"];
let rainTimer = null;
function startRain() {
  const layer = document.getElementById("rain-layer");
  rainTimer = setInterval(() => {
    const d = document.createElement("div"); d.className = "drop"; d.textContent = RAIN[(Math.random() * RAIN.length) | 0];
    d.style.left = Math.random() * 100 + "vw"; d.style.fontSize = 1.4 + Math.random() * 2 + "rem";
    const dur = 3 + Math.random() * 3; d.style.animationDuration = dur + "s";
    layer.appendChild(d); setTimeout(() => d.remove(), dur * 1000 + 200);
  }, 220);
}
function stopRain() { clearInterval(rainTimer); rainTimer = null; setTimeout(() => { document.getElementById("rain-layer").innerHTML = ""; }, 4000); }
const isMlg = () => document.documentElement.dataset.theme === "mlg";
function wireMlg() {
  document.addEventListener("pointerdown", (e) => { if (!isMlg()) return; hitmarker(e.clientX, e.clientY); if (document.body.classList.contains("mlg")) airhorn(); });
  document.getElementById("mlg-toggle").addEventListener("click", () => {
    if (!isMlg()) return;
    if (document.body.classList.toggle("mlg")) { airhorn(); startRain(); document.body.classList.add("shake"); setTimeout(() => document.body.classList.remove("shake"), 900); }
    else stopRain();
  });
}

/* ---------- thèmes ---------- */
const THEME_LABELS = { mlg: "🎮 MLG", performance: "📈 Performance", wealth: "💎 Wealth", pur: "⚪ Pur" };
function setTheme(name) {
  if (!THEME_LABELS[name]) name = "mlg";
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem("money-theme", name); } catch (e) {}
  const cur = document.getElementById("theme-current");
  if (cur) cur.textContent = THEME_LABELS[name];
  document.querySelectorAll(".theme-opt").forEach((o) => o.setAttribute("aria-current", o.dataset.theme === name ? "true" : "false"));
  if (name !== "mlg") { document.body.classList.remove("mlg", "shake"); stopRain(); }
  if (DATA) renderAll(); // recharge les couleurs des graphs selon le thème
}
function wireTheme() {
  const btn = document.getElementById("theme-btn");
  const menu = document.getElementById("theme-menu");
  if (!btn || !menu) return;
  const closeMs = parseFloat(cssVar("--dropdown-close-dur")) || 150;
  let open = false;
  const openMenu = () => { menu.classList.remove("is-closing"); menu.classList.add("is-open"); btn.setAttribute("aria-expanded", "true"); open = true; };
  const closeMenu = () => { menu.classList.remove("is-open"); menu.classList.add("is-closing"); btn.setAttribute("aria-expanded", "false"); open = false; setTimeout(() => menu.classList.remove("is-closing"), closeMs); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); open ? closeMenu() : openMenu(); });
  document.addEventListener("click", (e) => { if (open && !menu.contains(e.target) && e.target !== btn) closeMenu(); });
  menu.querySelectorAll(".theme-opt").forEach((o) => o.addEventListener("click", () => { setTheme(o.dataset.theme); closeMenu(); }));
  // applique le thème sauvegardé (sans re-render, DATA pas encore prête)
  let saved = "mlg";
  try { saved = localStorage.getItem("money-theme") || "mlg"; } catch (e) {}
  document.documentElement.dataset.theme = THEME_LABELS[saved] ? saved : "mlg";
  if (document.getElementById("theme-current")) document.getElementById("theme-current").textContent = THEME_LABELS[document.documentElement.dataset.theme];
  document.querySelectorAll(".theme-opt").forEach((o) => o.setAttribute("aria-current", o.dataset.theme === document.documentElement.dataset.theme ? "true" : "false"));
}

/* ============================================================
   boot
   ============================================================ */
async function boot() {
  try { DATA = await (await fetch("data.json", { cache: "no-store" })).json(); }
  catch (e) { document.querySelector(".wrap").innerHTML = `<div class="card"><h2 class="card-title">⚠️ data.json introuvable</h2></div>`; return; }
  document.getElementById("lastUpdate").textContent = new Date(DATA.lastUpdate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  wireTheme();
  wireTabBar("#account-tabs", (tab) => { currentAccount = tab.dataset.acc; });
  wireTabBar("#range-tabs", (tab) => { currentRange = +tab.dataset.range; });
  wireMlg();
  renderAll();
  renderNews();
}
document.addEventListener("DOMContentLoaded", boot);
