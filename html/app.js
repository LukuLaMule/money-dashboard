/* ============================================================
   money.luku.fr — dashboard read-only PEA/CTO
   ============================================================ */

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EUR2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} %`;

// palettes de camembert par thème (allocation / répartition pays)
const SERIES = {
  mlg: ["#39ff14", "#00e5ff", "#ff2e97", "#ffd000", "#ff7b00", "#9b5cff", "#ff2b2b", "#1ce8b5", "#ff5cf0", "#b0ff3c"],
  performance: ["#2fe6a0", "#3b9bff", "#7c5cff", "#ffcf4d", "#ff5d8f", "#1ce8b5", "#ff8a3c", "#5bd1ff", "#b388ff", "#9cff57"],
  wealth: ["#e7c977", "#c9a24e", "#b8862f", "#d8c48f", "#caa05a", "#9e7b4a", "#f0dca8", "#7a5c34", "#e0b769", "#8c6b3f"],
  pur: ["#2563eb", "#16a34a", "#db2777", "#f59e0b", "#0891b2", "#7c3aed", "#dc2626", "#0d9488", "#ca8a04", "#4f46e5"],
};
const doughnutColors = () => SERIES[document.documentElement.dataset.theme] || SERIES.mlg;
let DATA = null;
let currentAccount = "all";
let currentRange = 0; // mois ; 0 = max
let forecastYears = 10;
let currentBench = "";   // indice de comparaison ("" = aucun)
let BENCH = {};          // historiques d'indices (benchmarks.json)
let posSort = { key: "value", dir: -1 }; // tri du tableau des positions
let charts = {};
let INTRADAY = null; // intraday.json — points de la séance (~10 min)
let DAILY = null;    // daily.json — historique journalier des valos
let RECAP = null;    // recap.json — récap du mois écoulé
let HISTORY = null;  // history.json — cours mensuels par ISIN (fiche position)

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

/* ---------- secteur par ISIN ---------- */
const SECTOR_BY_ISIN = {
  // ETF
  FR0013412285: "🧺 ETF diversifié", FR0010755611: "🧺 ETF diversifié", LU2655993207: "🧺 ETF diversifié",
  FR0013411980: "🧺 ETF diversifié", FR0013412020: "🧺 ETF diversifié",
  // PEA actions
  FR0000120073: "🏭 Industrie", FR0000121329: "🛡️ Défense", NL0000235190: "✈️ Aéronautique",
  FR0000120578: "💊 Santé", FR0000120628: "🏦 Finance",
  // CTO actions
  US0420682058: "💻 Tech / Semi", US0079031078: "💻 Tech / Semi", US5949181045: "💻 Tech",
  US0937121079: "⚡ Énergie", US36467W1099: "🛒 Conso", US0846701086: "🏦 Finance",
  US5949724083: "₿ Crypto / Tech",
};
const sectorOf = (p) => (p.isin && SECTOR_BY_ISIN[p.isin]) || "🌐 Autre";

/* facteur de levier par ISIN (1 = normal) — pour le prévisionnel pondéré */
const LEVERAGE_BY_ISIN = {
  FR0010755611: 2, // Amundi MSCI USA Daily (2x) Leveraged
};
const levOf = (p) => (p.isin && LEVERAGE_BY_ISIN[p.isin]) || 1;

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
  if (!currentRange) return null;
  // calendaire : « 1M » = depuis 1 mois jour pour jour (cohérent avec les points journaliers)
  const d = new Date(); d.setMonth(d.getMonth() - currentRange);
  return d.toISOString().slice(0, 10);
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

/* XIRR (taux de rendement interne annualisé) par bisection — robuste, pas de dérivée */
function xirr(flows) {
  if (flows.length < 2) return null;
  const t0 = flows[0].t;
  const yr = (d) => (d - t0) / 31557600000; // ms → années
  const f = (r) => flows.reduce((a, c) => a + c.v / Math.pow(1 + r, yr(c.t)), 0);
  let lo = -0.95, hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
  return ((lo + hi) / 2) * 100;
}

function computeKpis() {
  const dates = monthsSorted();
  const last = dates[dates.length - 1];
  const sumAt = (date, f) => DATA.snapshots.filter((s) => s.date === date && accFilter(s) && s[f] != null).reduce((a, r) => a + r[f], 0);
  const value = sumAt(last, "value") || sumAt(last, "invested");
  const invested = sumAt(last, "invested");
  const gain = value - invested;
  const gainPct = invested ? (gain / invested) * 100 : 0;
  // perf des POSITIONS détenues depuis l'achat = (valeur - coût) / coût
  // (robuste : marche pour le PEA comme pour le CTO qui n'a pas d'historique de valeur)
  const fpos = DATA.positions.filter(accFilter);
  const totVal = fpos.reduce((a, p) => a + posValue(p), 0);
  const totGain = fpos.reduce((a, p) => a + posGain(p), 0);
  const totCost = totVal - totGain;
  const perf = totCost > 0 ? (totGain / totCost) * 100 : 0;
  // gain/perte du jour (cours actuel vs clôture de la veille)
  let dayPnL = 0, dayBase = 0;
  fpos.forEach((p) => {
    if (p.prevClose != null && p.last != null && p.shares != null) {
      dayPnL += p.shares * (p.last - p.prevClose);
      dayBase += p.shares * p.prevClose;
    }
  });
  const dayPct = dayBase ? (dayPnL / dayBase) * 100 : 0;
  const div = DATA.dividends.filter(accFilter).reduce((a, r) => a + r.amount, 0);
  // rendement : dividendes encaissés sur les 12 derniers mois / valeur actuelle
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const div12 = DATA.dividends.filter(accFilter).filter((d) => new Date(d.date) >= yearAgo).reduce((a, r) => a + r.amount, 0);
  const yieldPct = value ? (div12 / value) * 100 : 0;
  // TRI annualisé : apports datés (Δinvested mensuel) en sorties, valeur actuelle en entrée
  let prevInv = 0; const flows = [];
  for (const d of dates) {
    const inv = sumAt(d, "invested"); const c = inv - prevInv; prevInv = inv;
    if (Math.abs(c) > 0.005) flows.push({ t: new Date(d), v: -c });
  }
  flows.push({ t: new Date(), v: value });
  const xirrPct = value > 0 ? xirr(flows) : null;
  return { value, invested, gain, gainPct, perf, div, div12, yieldPct, dayPnL, dayBase, dayPct, xirrPct };
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
  // KPI Aujourd'hui (variation du jour vs clôture veille)
  const dayEl = document.querySelector('[data-kpi="day"] .kpi-value');
  if (k.dayBase > 0) {
    // centimes quand le montant est petit, pour éviter un « 0 € » trompeur
    const fmtDay = Math.abs(k.dayPnL) < 10 ? EUR2 : EUR;
    set("day", `${k.dayPnL >= 0 ? "+" : ""}${fmtDay.format(k.dayPnL)}`);
    sub("day", PCT(k.dayPct), k.dayPnL >= 0 ? "pos" : "neg");
    if (dayEl) { dayEl.classList.toggle("pos", k.dayPnL >= 0); dayEl.classList.toggle("neg", k.dayPnL < 0); }
  } else {
    set("day", "—"); sub("day", "vs hier", "");
    if (dayEl) dayEl.classList.remove("pos", "neg");
  }
  sub("gain", PCT(k.gainPct), k.gain >= 0 ? "pos" : "neg");
  sub("div", `rendement ${k.yieldPct.toFixed(2)} %/an`, "");
  sub("perf", "positions · depuis l'achat", k.perf >= 0 ? "pos" : "neg");
  // TRI annualisé (XIRR)
  const xirrEl = document.querySelector('[data-kpi="xirr"] .kpi-value');
  if (k.xirrPct != null && isFinite(k.xirrPct)) {
    set("xirr", PCT(k.xirrPct));
    sub("xirr", "%/an · pondéré des apports", k.xirrPct >= 0 ? "pos" : "neg");
    if (xirrEl) { xirrEl.classList.toggle("pos", k.xirrPct >= 0); xirrEl.classList.toggle("neg", k.xirrPct < 0); }
  } else {
    set("xirr", "—"); sub("xirr", "pas assez d'historique", "");
  }
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

/* points combinés pour la courbe valeur/investi :
   snapshots MENSUELS (historique) + daily.json (granularité JOUR, depuis 2026-06)
   + point live du jour (dernier point intraday). Dédoublonnés par date. */
function combinedPoints() {
  const by = new Map(); // date → {d, val, inv}
  for (const d of monthsSorted()) {
    const rows = DATA.snapshots.filter((s) => s.date === d && accFilter(s));
    if (!rows.length) continue;
    const val = rows.some((r) => r.value != null) ? rows.reduce((a, r) => a + (r.value || 0), 0) : null;
    by.set(d, { d, val, inv: rows.reduce((a, r) => a + (r.invested || 0), 0) });
  }
  const accs = currentAccount === "all" ? DATA.accounts.map((a) => a.id) : [currentAccount];
  for (const [d, accVals] of Object.entries(DAILY || {})) {
    if (accs.every((a) => accVals[a]))
      by.set(d, { d, val: accs.reduce((s, a) => s + accVals[a].v, 0), inv: accs.reduce((s, a) => s + accVals[a].i, 0) });
  }
  // point live (dernière mesure de la séance en cours)
  const ipts = (INTRADAY && INTRADAY.points) || [];
  if (INTRADAY && ipts.length && accs.every((a) => ipts[ipts.length - 1][a] != null)) {
    const lp = ipts[ipts.length - 1];
    by.set(INTRADAY.date, { d: INTRADAY.date, val: accs.reduce((s, a) => s + lp[a], 0), inv: accs.reduce((s, a) => s + ((INTRADAY.invested || {})[a] || 0), 0) });
  }
  return [...by.values()].sort((a, b) => a.d.localeCompare(b.d));
}
const ptLabel = (d) => (d.endsWith("-01") ? d.slice(0, 7) : `${d.slice(8)}/${d.slice(5, 7)}`);

function renderPerf() {
  destroy("perf");
  const p = palette(); Chart.defaults.color = p.tick;
  const allPts = combinedPoints();
  const pts = allPts.filter((pt) => inRange(pt.d));
  const labels = pts.map((pt) => ptLabel(pt.d));
  const valSeries = pts.map((pt) => pt.val);
  const invSeries = pts.map((pt) => pt.inv);
  const lastIdx = valSeries.reduce((acc, v, i) => (v != null ? i : acc), -1);
  const lastDot = (color) => ({ pointRadius: (ctx) => (ctx.dataIndex === lastIdx ? 5 : 0), pointBackgroundColor: color, pointBorderColor: color, pointHoverRadius: 6 });
  const datasets = [
    { label: "Valorisation", data: valSeries, borderColor: p.neon, backgroundColor: withAlpha(p.neon, "20"), fill: true, tension: .35, borderWidth: 3, spanGaps: true, ...lastDot(p.neon) },
    { label: "Investi", data: invSeries, borderColor: p.gold, borderDash: [6, 5], fill: false, tension: .25, borderWidth: 2, spanGaps: true, ...lastDot(p.gold) },
  ];
  // comparaison indice : "si j'avais investi MES apports (DCA) sur l'indice depuis le début"
  if (currentBench && BENCH[currentBench]) {
    const series = BENCH[currentBench];
    const priceAt = (m) => {
      if (series[m] != null) return series[m];
      const ks = Object.keys(series).filter((k) => k <= m).sort();
      return ks.length ? series[ks[ks.length - 1]] : null;
    };
    let units = 0, prevInv = 0;
    const whatif = {};
    for (const pt of allPts) {
      const price = priceAt(pt.d.slice(0, 7) + "-01"), contrib = pt.inv - prevInv;
      prevInv = pt.inv;
      if (price) { units += contrib / price; whatif[pt.d] = Math.round(units * price); }
      else whatif[pt.d] = null;
    }
    const data = pts.map((pt) => whatif[pt.d]);
    const benchColor = "#ff2e97"; // magenta vif fixe → visible sur tous les thèmes
    datasets.push({ label: `Si investi sur ${currentBench}`, data, borderColor: benchColor, backgroundColor: benchColor, borderDash: [8, 4], borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, fill: false, spanGaps: true });
  }
  charts.perf = new Chart(document.getElementById("perfChart"), {
    type: "line",
    data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 14 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? "—" : EUR.format(c.parsed.y)}` } } },
      scales: { x: { grid: { color: p.grid } }, y: { grid: { color: p.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
  });
  // légende chiffrée : valeur actuelle vs investi
  const cap = document.getElementById("perf-cap");
  if (cap) {
    const lv = lastIdx >= 0 ? valSeries[lastIdx] : null, li = lastIdx >= 0 ? invSeries[lastIdx] : null;
    if (lv != null && li != null) {
      const g = lv - li, gp = li ? (g / li) * 100 : 0;
      cap.innerHTML = `📍 Aujourd'hui — <b style="color:var(--neon)">${EUR.format(lv)}</b> valorisation · <b style="color:var(--gold)">${EUR.format(li)}</b> investi · <span class="${g >= 0 ? "pos" : "neg"}">${g >= 0 ? "+" : ""}${EUR.format(g)} (${PCT(gp)})</span>`;
    } else cap.textContent = "";
  }
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
  const border = cssVar("--panel") || "#0e1411";
  return new Chart(document.getElementById(canvasId), {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: doughnutColors(), borderColor: border, borderWidth: 3 }] },
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

function renderBars(boxId, keyFn) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const by = {};
  DATA.positions.filter(accFilter).forEach((p) => { const k = keyFn(p); by[k] = (by[k] || 0) + posValue(p); });
  const entries = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { box.innerHTML = `<p class="muted">Aucune position.</p>`; return; }
  const total = entries.reduce((a, e) => a + e[1], 0) || 1;
  const colors = doughnutColors();
  const pcts = entries.map((e) => (e[1] / total) * 100);
  box.innerHTML = entries.map(([z, v], i) => `
    <div class="bar-row" title="${EUR.format(v)}">
      <span class="bar-label">${z}</span>
      <span class="bar-track"><span class="bar-fill" style="width:0;background:${colors[i % colors.length]}"></span></span>
      <span class="bar-val">${pcts[i].toFixed(1)} %</span>
    </div>`).join("");
  requestAnimationFrame(() => box.querySelectorAll(".bar-fill").forEach((el, i) => { el.style.width = pcts[i].toFixed(1) + "%"; }));
}
const renderCountry = () => renderBars("countryBars", zoneOf);
const renderSector = () => renderBars("sectorBars", sectorOf);

function renderTable() {
  const tbody = document.querySelector("#positions tbody");
  tbody.innerHTML = "";
  const accLabel = Object.fromEntries(DATA.accounts.map((a) => [a.id, a.label]));
  const NEG = -Infinity;
  const ext = {
    ticker: (p) => p.ticker || "", label: (p) => p.label || "", account: (p) => p.account || "", zone: (p) => zoneOf(p),
    shares: (p) => (p.shares == null ? NEG : p.shares), pru: (p) => (p.pru == null ? NEG : p.pru),
    last: (p) => (p.last == null ? NEG : p.last), value: (p) => p._val, perf: (p) => p._pct,
    day: (p) => (p._day == null ? NEG : p._day),
  };
  const get = ext[posSort.key] || ext.value;
  // indicateur de tri sur l'en-tête
  document.querySelectorAll("#positions th.sortable").forEach((th) => {
    th.classList.toggle("sort-asc", th.dataset.sort === posSort.key && posSort.dir === 1);
    th.classList.toggle("sort-desc", th.dataset.sort === posSort.key && posSort.dir === -1);
  });
  DATA.positions.filter(accFilter)
    .map((p) => ({
      ...p, _val: posValue(p), _gain: posGain(p), _pct: posGainPct(p),
      _day: p.shares != null && p.last != null && p.prevClose != null ? p.shares * (p.last - p.prevClose) : null,
      _dayPct: p.last != null && p.prevClose ? ((p.last - p.prevClose) / p.prevClose) * 100 : 0,
    }))
    .sort((a, b) => { const x = get(a), y = get(b); const c = typeof x === "string" ? x.localeCompare(y) : x - y; return c * posSort.dir; })
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
        <td class="num ${p._day == null ? "" : p._day >= 0 ? "pos" : "neg"}">${p._day == null ? dash : `${p._day >= 0 ? "+" : ""}${EUR2.format(p._day)} (${PCT(p._dayPct)})`}</td>
        <td class="num">${EUR.format(p._val)}</td>
        <td class="num ${cls}">${p._gain >= 0 ? "+" : ""}${EUR.format(p._gain)} (${PCT(p._pct)})</td>`;
      tr.addEventListener("click", () => openPosModal(p));
      tbody.appendChild(tr);
    });
}

/* ---------- fiche détail par position (modal) ---------- */
function closePosModal() {
  const m = document.getElementById("pos-modal");
  if (m) { m.hidden = true; destroy("pos"); }
}
function openPosModal(p) {
  const m = document.getElementById("pos-modal");
  if (!m) return;
  const accLabel = Object.fromEntries(DATA.accounts.map((a) => [a.id, a.label]));
  document.getElementById("pos-title").innerHTML =
    `<strong>${p.ticker}</strong> · ${p.label} <span class="badge ${p.account}">${accLabel[p.account] || p.account}</span> <span class="muted">${zoneOf(p)}</span>`;
  // stats
  const total = DATA.positions.filter(accFilter).reduce((a, q) => a + posValue(q), 0) || 1;
  const divsLine = DATA.dividends.filter((d) => (p.isin && d.isin ? d.isin === p.isin : d.ticker === p.ticker));
  const divSum = divsLine.reduce((a, d) => a + d.amount, 0);
  const stat = (label, value, cls2) => `<div class="pos-stat"><span class="p-label">${label}</span><span class="p-value ${cls2 || ""}">${value}</span></div>`;
  const dash = "—";
  const dayPnl = p._day, dayPct = p._dayPct;
  document.getElementById("pos-stats").innerHTML =
    stat("COURS", p.last != null ? EUR2.format(p.last) : dash) +
    stat("PRU", p.pru != null ? EUR2.format(p.pru) : dash) +
    stat("QUANTITÉ", p.shares != null ? (+p.shares).toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : dash) +
    stat("VALEUR", EUR.format(p._val)) +
    stat("POIDS", `${((p._val / total) * 100).toFixed(1)} %`) +
    stat("+/- VALUE", `${p._gain >= 0 ? "+" : ""}${EUR.format(p._gain)} (${PCT(p._pct)})`, p._gain >= 0 ? "pos" : "neg") +
    stat("AUJOURD'HUI", dayPnl != null ? `${dayPnl >= 0 ? "+" : ""}${EUR2.format(dayPnl)} (${PCT(dayPct)})` : dash, dayPnl != null ? (dayPnl >= 0 ? "pos" : "neg") : "") +
    stat("DIVIDENDES REÇUS", divSum ? `${EUR2.format(divSum)} (${divsLine.length}×)` : "0 €");
  // courbe mensuelle du cours + ligne PRU
  destroy("pos");
  const series = (HISTORY && p.isin && HISTORY[p.isin]) || null;
  const note = document.getElementById("pos-note");
  if (series && Object.keys(series).length > 1) {
    const pal = palette();
    const months = Object.keys(series).sort();
    charts.pos = new Chart(document.getElementById("posChart"), {
      type: "line",
      data: { labels: months.map((x) => x.slice(0, 7)), datasets: [
        { label: "Cours", data: months.map((x) => series[x]), borderColor: pal.neon, backgroundColor: withAlpha(pal.neon, "18"), fill: true, tension: .3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
        ...(p.pru != null ? [{ label: "PRU", data: months.map(() => p.pru), borderColor: pal.gold, borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false }] : []),
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${EUR2.format(c.parsed.y)}` } } },
        scales: { x: { grid: { color: pal.grid }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: pal.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
    });
    note.textContent = "Clôtures mensuelles (Yahoo). La ligne or = ton prix de revient.";
  } else {
    note.textContent = "Pas d'historique de cours disponible pour cette ligne.";
  }
  m.hidden = false;
}
function wirePosModal() {
  const m = document.getElementById("pos-modal");
  if (!m) return;
  m.querySelector(".pos-backdrop").addEventListener("click", closePosModal);
  m.querySelector(".pos-close").addEventListener("click", closePosModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePosModal(); });
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
  // mini-calendrier : somme estimée par mois sur les 12 prochains mois
  destroy("cal");
  const p = palette(); Chart.defaults.color = p.tick;
  const buckets = {}; const labels12 = [];
  for (let i = 0; i < 12; i++) { const dt = new Date(today.getFullYear(), today.getMonth() + i, 1); const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; buckets[key] = 0; labels12.push(dt.toLocaleDateString("fr-FR", { month: "short" })); }
  proj.forEach((d) => { const key = `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, "0")}`; if (key in buckets) buckets[key] += d.amount; });
  const calCanvas = document.getElementById("calChart");
  if (calCanvas) charts.cal = new Chart(calCanvas, {
    type: "bar",
    data: { labels: labels12, datasets: [{ data: Object.keys(buckets).map((k) => buckets[k]), backgroundColor: p.neon, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => EUR2.format(c.parsed.y) } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: p.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
  });

  if (!proj.length) { tbody.innerHTML = `<tr><td colspan="4" class="muted">Pas assez d'historique pour estimer.</td></tr>`; return; }
  proj.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.month}</td><td><strong>${d.ticker}</strong></td><td>${d.label}</td><td class="num">${EUR2.format(d.amount)}</td>`;
    tbody.appendChild(tr);
  });
}

/* prévisionnel : projection par scénarios de rendement, apports mensuels poursuivis */
function renderForecast() {
  destroy("forecast");
  const p = palette(); Chart.defaults.color = p.tick;
  const k = computeKpis();
  const v0 = k.value || k.invested || 0;
  const val = (id, def) => { const el = document.getElementById(id); return el ? (+el.value || 0) : def; };
  const C = Math.max(0, val("forecast-monthly", 150));
  const rate = Math.max(0, val("forecast-rate", 7));
  const rv = document.getElementById("forecast-rate-val"); if (rv) rv.textContent = rate + " %";
  const infl = !!(document.getElementById("forecast-infl") && document.getElementById("forecast-infl").checked);
  const divOn = !(document.getElementById("forecast-div") && !document.getElementById("forecast-div").checked); // défaut: oui
  const H = forecastYears;
  const year0 = new Date().getFullYear();
  const labels = Array.from({ length: H + 1 }, (_, y) => String(year0 + y));
  const defl = (y) => (infl ? Math.pow(1.02, y) : 1); // euros constants (inflation 2 %)
  // levier moyen pondéré par la valeur des positions (poche ETF ×2 → amplifie le rendement marché)
  const fp = DATA.positions.filter(accFilter);
  const totV = fp.reduce((a, q) => a + posValue(q), 0) || 1;
  const wLev = fp.reduce((a, q) => a + posValue(q) * levOf(q), 0) / totV;
  const yld = divOn ? (k.yieldPct || 0) : 0; // dividendes réinvestis (%/an)
  const rEff = (base) => Math.max(0, base) * wLev + yld; // rendement annuel effectif (%)
  const rates = [
    { name: `Pessimiste · ${rEff(rate - 4).toFixed(1)} %/an`, r: rEff(rate - 4) / 100, color: p.red },
    { name: `Attendu · ${rEff(rate).toFixed(1)} %/an`, r: rEff(rate) / 100, color: p.cyan },
    { name: `Optimiste · ${rEff(rate + 4).toFixed(1)} %/an`, r: rEff(rate + 4) / 100, color: p.neon },
  ];
  const datasets = rates.map((s) => {
    const rm = Math.pow(1 + s.r, 1 / 12) - 1;
    let v = v0; const pts = [Math.round(v / defl(0))];
    for (let y = 1; y <= H; y++) { for (let m = 0; m < 12; m++) v = v * (1 + rm) + C; pts.push(Math.round(v / defl(y))); }
    return { label: s.name, data: pts, borderColor: s.color, backgroundColor: "transparent", fill: false, tension: .3, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4 };
  });
  datasets.push({
    label: "Capital investi", data: labels.map((_, y) => Math.round((k.invested + C * 12 * y) / defl(y))),
    borderColor: p.gold, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, fill: false,
  });
  charts.forecast = new Chart(document.getElementById("forecastChart"), {
    type: "line", data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 14 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${EUR.format(c.parsed.y)}` } } },
      scales: { x: { grid: { color: p.grid } }, y: { grid: { color: p.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
  });
  const note = document.getElementById("forecast-note");
  if (note) note.textContent = `Base ${EUR.format(v0)} + ${EUR.format(C)}/mois sur ${H} ans · rendement marché ${rate} %/an`
    + (wLev > 1.001 ? ` × levier moyen ×${wLev.toFixed(2)}` : "")
    + (yld ? ` + ${yld.toFixed(1)} % div. réinvestis` : "")
    + (infl ? " · euros constants (infl. 2 %)" : "")
    + ". Projection non contractuelle.";
}

/* sparkline de la séance (carte KPI Aujourd'hui) — points intraday du compte filtré */
function renderDaySpark() {
  destroy("spark");
  const box = document.querySelector('[data-kpi="day"] .spark-box');
  if (!box) return;
  const today = new Date().toISOString().slice(0, 10);
  const ipts = (INTRADAY && INTRADAY.date === today && INTRADAY.points) || [];
  const accs = currentAccount === "all" ? DATA.accounts.map((a) => a.id) : [currentAccount];
  const vals = ipts.map((pt) => (accs.every((a) => pt[a] != null) ? accs.reduce((s, a) => s + pt[a], 0) : null));
  const nn = vals.filter((v) => v != null);
  if (nn.length < 2) { box.classList.add("empty"); return; }
  box.classList.remove("empty");
  const up = nn[nn.length - 1] >= nn[0];
  const color = up ? "#2fe6a0" : "#ff5d5d";
  charts.spark = new Chart(document.getElementById("daySpark"), {
    type: "line",
    data: { labels: ipts.map((pt) => pt.t), datasets: [{ data: vals, borderColor: color, backgroundColor: withAlpha(color, "22"), fill: true, borderWidth: 1.8, pointRadius: 0, pointHoverRadius: 3, tension: .3, spanGaps: true }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { title: (c) => c[0].label, label: (c) => EUR.format(c.parsed.y) } } },
      scales: { x: { display: false }, y: { display: false } } },
  });
}

/* statuts d'ouverture des marchés où cotent les positions (hors jours fériés) */
function marketStatus() {
  const tz = (zone) => { const p = new Date(new Date().toLocaleString("en-US", { timeZone: zone })); return { wd: p.getDay() >= 1 && p.getDay() <= 5, min: p.getHours() * 60 + p.getMinutes() }; };
  const paris = tz("Europe/Paris"), ny = tz("America/New_York"), ldn = tz("Europe/London"), tyo = tz("Asia/Tokyo");
  return [
    { flag: "🇫🇷", name: "Euronext", open: paris.wd && paris.min >= 9 * 60 && paris.min < 17 * 60 + 30, hours: "9h00 – 17h30 heure de Paris" },
    { flag: "🇩🇪", name: "Francfort", open: paris.wd && paris.min >= 8 * 60 && paris.min < 22 * 60, hours: "8h00 – 22h00 heure de Paris — Stuttgart/Francfort, où cotent les titres US du CTO" },
    { flag: "🇺🇸", name: "NYSE", open: ny.wd && ny.min >= 9 * 60 + 30 && ny.min < 16 * 60, hours: "≈ 15h30 – 22h00 heure de Paris (9h30 – 16h00 à New York) — séance régulière NYSE/NASDAQ" },
    { flag: "🇬🇧", name: "Londres", open: ldn.wd && ldn.min >= 8 * 60 && ldn.min < 16 * 60 + 30, hours: "≈ 9h00 – 17h30 heure de Paris (8h00 – 16h30 à Londres) — LSE" },
    { flag: "🇯🇵", name: "Tokyo", open: tyo.wd && tyo.min >= 9 * 60 && tyo.min < 15 * 60 + 30, hours: "≈ 2h00 – 8h30 heure de Paris (9h00 – 15h30 à Tokyo) — TSE" },
    { flag: "₿", name: "Crypto", open: true, hours: "24/7" },
  ];
}

/* fraîcheur des cours (header) — basée sur lastUpdateTime posé par record_value.py */
function renderFreshness() {
  const el = document.getElementById("freshness");
  if (!el || !DATA) return;
  let ago = "";
  if (DATA.lastUpdateTime) {
    const min = Math.max(0, Math.round((Date.now() - new Date(DATA.lastUpdateTime)) / 60000));
    ago = min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : min < 1440 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`;
    ago = `<span class="mkt">cours mis à jour ${ago}</span>`;
  }
  const chips = marketStatus().map((m) =>
    `<span class="mkt" title="${m.hours}"><span class="dot ${m.open ? "open" : "closed"}"></span>${m.flag} ${m.name}</span>`).join("");
  el.innerHTML = ago + chips;
}

/* récap du mois écoulé (recap.json, généré le 1er du mois) */
function renderRecap() {
  const card = document.getElementById("recap-card");
  if (!card || !RECAP || !RECAP.month) return;
  const box = document.getElementById("recap");
  const title = document.getElementById("recap-month");
  if (title) title.textContent = "— " + (RECAP.label || RECAP.month);
  const sgn = (v) => `${v >= 0 ? "+" : ""}`;
  const cls = (v) => (v >= 0 ? "pos" : "neg");
  const item = (label, value, sub) => `<div class="recap-item"><span class="r-label">${label}</span><span class="r-value">${value}</span>${sub ? `<span class="r-sub">${sub}</span>` : ""}</div>`;
  const lines = (arr) => (arr || []).map((x) => `<span class="${cls(x.pct)}">${x.t} ${sgn(x.pct)}${x.pct.toFixed(1)} %</span>`).join(" · ") || "—";
  // comparatif des 6 derniers mois : mini barres centrées sur zéro
  let monthsHtml = "";
  if (RECAP.months && RECAP.months.length > 1) {
    const maxAbs = Math.max(...RECAP.months.map((m) => Math.abs(m.pct)), 0.1);
    monthsHtml = `<div class="recap-item recap-months"><span class="r-label">6 DERNIERS MOIS (hors apports)</span><div class="rm-bars">` +
      RECAP.months.map((m) => {
        const h = Math.round((Math.abs(m.pct) / maxAbs) * 34);
        return `<div class="rm-col" title="${m.label} : ${sgn(m.pct)}${m.pct.toFixed(2)} %">
          <span class="rm-pct ${cls(m.pct)}">${sgn(m.pct)}${m.pct.toFixed(1)}</span>
          <span class="rm-track"><span class="rm-bar ${cls(m.pct)}" style="height:${Math.max(2, h)}px"></span></span>
          <span class="rm-month">${m.label}</span></div>`;
      }).join("") + `</div></div>`;
  }
  box.innerHTML =
    item("PERF DU MOIS (hors apports)", `<span class="${cls(RECAP.gain)}">${sgn(RECAP.gain)}${EUR.format(RECAP.gain)} (${sgn(RECAP.gain_pct)}${RECAP.gain_pct.toFixed(1)} %)</span>`,
      `${EUR.format(RECAP.start_value)} → ${EUR.format(RECAP.end_value)}${RECAP.contrib ? ` · apports ${EUR.format(RECAP.contrib)}` : ""}`) +
    item("DIVIDENDES ENCAISSÉS", EUR2.format(RECAP.dividends || 0), "") +
    item("TOP DU MOIS", lines(RECAP.top), "") +
    item("FLOP DU MOIS", lines(RECAP.flop), "") +
    monthsHtml;
  card.hidden = false;
}

/* heatmap calendrier (style GitHub) : perf quotidienne hors apports, depuis daily.json */
function renderHeatmap() {
  const card = document.getElementById("heatmap-card");
  const box = document.getElementById("heatmap");
  if (!card || !box) return;
  const accs = currentAccount === "all" ? DATA.accounts.map((a) => a.id) : [currentAccount];
  // série quotidienne {date → {v, i}} agrégée sur les comptes filtrés (+ point live)
  const days = [];
  for (const [d, by] of Object.entries(DAILY || {})) {
    if (accs.every((a) => by[a])) days.push({ d, v: accs.reduce((s, a) => s + by[a].v, 0), i: accs.reduce((s, a) => s + by[a].i, 0) });
  }
  const ipts = (INTRADAY && INTRADAY.points) || [];
  if (INTRADAY && ipts.length && accs.every((a) => ipts[ipts.length - 1][a] != null) && !days.some((x) => x.d === INTRADAY.date)) {
    const lp = ipts[ipts.length - 1];
    days.push({ d: INTRADAY.date, v: accs.reduce((s, a) => s + lp[a], 0), i: accs.reduce((s, a) => s + ((INTRADAY.invested || {})[a] || 0), 0) });
  }
  days.sort((a, b) => a.d.localeCompare(b.d));
  if (days.length < 2) { card.hidden = true; return; } // pas encore assez d'historique journalier
  // perf de chaque jour vs jour précédent, nette des apports
  const cells = [];
  for (let i = 1; i < days.length; i++) {
    const contrib = days[i].i - days[i - 1].i;
    const base = days[i - 1].v + Math.max(0, contrib);
    if (base > 0) cells.push({ d: days[i].d, pct: ((days[i].v - days[i - 1].v - contrib) / base) * 100 });
  }
  if (!cells.length) { card.hidden = true; return; }
  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.pct)), 0.2);
  const level = (p) => Math.min(4, Math.max(1, Math.ceil((Math.abs(p) / maxAbs) * 4)));
  // grille en colonnes-semaines (lun→ven), avec cases vides pour aligner le 1er jour
  const dow = (ds) => (new Date(ds + "T12:00:00").getDay() + 6) % 7; // 0 = lundi
  let html = "";
  let pad = dow(cells[0].d);
  if (pad > 4) pad = 0; // commence un week-end (rare) → pas de padding
  for (let i = 0; i < pad; i++) html += `<span class="hm-cell hm-empty"></span>`;
  cells.forEach((c) => {
    if (dow(c.d) > 4) return; // week-end (crypto seule) : ignoré pour garder lun-ven
    const klass = c.pct >= 0 ? `hm-pos-${level(c.pct)}` : `hm-neg-${level(c.pct)}`;
    const dt = new Date(c.d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
    html += `<span class="hm-cell ${klass}" title="${dt} : ${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(2)} %"></span>`;
  });
  box.innerHTML = html;
  card.hidden = false;
}

/* discipline d'investissement : apports réels par mois vs objectif fixé
   (convention snapshots : daté M-01 = cumul FIN du mois M → apports du mois M
    = invested(M) − invested(mois précédent) ; le mois courant grandit au fil des apports) */
function renderDiscipline() {
  destroy("discipline");
  const cv = document.getElementById("disciplineChart");
  if (!cv) return;
  const p = palette(); Chart.defaults.color = p.tick;
  let goal = 200;
  try { goal = Math.max(0, +localStorage.getItem("money-goal") || 200); } catch (e) {}
  const input = document.getElementById("goal-monthly");
  if (input && document.activeElement !== input) input.value = goal;
  const months = monthsSorted();
  const sumInv = (d) => DATA.snapshots.filter((s) => s.date === d && accFilter(s) && s.invested != null).reduce((a, r) => a + r.invested, 0);
  const rows = [];
  for (let i = 1; i < months.length; i++) {
    rows.push({ m: months[i].slice(0, 7), c: Math.max(0, sumInv(months[i]) - sumInv(months[i - 1])), cur: i === months.length - 1 });
  }
  const view = rows.filter((r) => inRange(r.m + "-01"));
  if (!view.length) return;
  const GREEN = "#2fe6a0", RED = "#ff5d5d", PARTIAL = p.gold, CUR = p.cyan;
  const colorOf = (r) => (r.c >= goal && goal > 0 ? GREEN : r.cur ? CUR : r.c > 0 ? PARTIAL : RED);
  charts.discipline = new Chart(cv, {
    type: "bar",
    data: { labels: view.map((r) => r.m), datasets: [
      { label: "Apports", data: view.map((r) => r.c), backgroundColor: view.map(colorOf), borderRadius: 5 },
      { label: `Objectif ${EUR.format(goal)}`, data: view.map(() => goal), type: "line", borderColor: p.red, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, fill: false },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${EUR.format(c.parsed.y)}`,
        afterBody: (items) => { const r = view[items[0].dataIndex]; return r.cur ? "mois en cours" : r.c >= goal && goal > 0 ? "✅ objectif tenu" : r.c > 0 ? "🟡 partiel" : "❌ raté"; } } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: p.grid }, ticks: { callback: (v) => EUR.format(v) } } } },
  });
  // stats : mois finis uniquement (le mois courant ne compte ni pour ni contre, sauf déjà atteint)
  const done = rows.filter((r) => !r.cur);
  const ok = done.filter((r) => r.c >= goal && goal > 0).length;
  let streak = 0;
  const seq = [...done, ...(rows.length && rows[rows.length - 1].c >= goal && goal > 0 ? [rows[rows.length - 1]] : [])];
  for (let i = seq.length - 1; i >= 0 && seq[i].c >= goal && goal > 0; i--) streak++;
  const ecart = done.reduce((a, r) => a + (r.c - goal), 0);
  const statsEl = document.getElementById("discipline-stats");
  if (statsEl) statsEl.innerHTML = goal > 0
    ? `✅ <b>${ok}/${done.length}</b> mois tenus · 🔥 série en cours : <b>${streak}</b> · écart cumulé vs plan : <span class="${ecart >= 0 ? "pos" : "neg"}">${ecart >= 0 ? "+" : ""}${EUR.format(ecart)}</span>`
    : "Fixe un objectif pour activer le suivi.";
  const cap = document.getElementById("discipline-cap");
  if (cap) {
    const curRow = rows[rows.length - 1];
    cap.innerHTML = curRow ? `📍 Ce mois-ci : <b>${EUR.format(curRow.c)}</b> sur ${EUR.format(goal)} ${curRow.c >= goal && goal > 0 ? "— ✅ objectif atteint !" : `— reste ${EUR.format(Math.max(0, goal - curRow.c))}`}` : "";
  }
}

function renderAll() {
  renderKpis(); renderPerf(); renderDiv(); renderAlloc(); renderCountry(); renderSector(); renderForecast(); renderTable(); renderUpcoming(); renderDaySpark(); renderHeatmap(); renderDiscipline();
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

/* tri du tableau des positions au clic sur les en-têtes */
function wirePositionsSort() {
  document.querySelectorAll("#positions th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (posSort.key === key) posSort.dir *= -1;
      else posSort = { key, dir: ["ticker", "label", "account", "zone"].includes(key) ? 1 : -1 };
      renderTable();
    });
  });
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
const THEME_SUB = {
  mlg: "PEA × CTO · 420% NOSCOPE PORTFOLIO · READ ONLY",
  performance: "PEA × CTO · SUIVI DE PORTEFEUILLE · LECTURE SEULE",
  wealth: "PEA × CTO · Gestion de patrimoine · Lecture seule",
  pur: "PEA × CTO · Lecture seule",
};
function applyThemeSub(name) {
  const el = document.querySelector(".hero-sub");
  if (el) el.textContent = THEME_SUB[name] || THEME_SUB.mlg;
}
const THEME_TAGLINE = {
  mlg: "💸 DEVIENS RICHE COMME LUKU 💸",
  performance: "Deviens riche comme Luku",
  wealth: "Deviens riche comme Luku",
  pur: "Deviens riche comme Luku",
};
function applyThemeTagline(name) {
  const el = document.getElementById("hero-tagline");
  if (el) el.textContent = THEME_TAGLINE[name] || THEME_TAGLINE.mlg;
}
function setTheme(name) {
  if (!THEME_LABELS[name]) name = "pur";
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem("money-theme", name); } catch (e) {}
  const cur = document.getElementById("theme-current");
  if (cur) cur.textContent = THEME_LABELS[name];
  applyThemeSub(name); applyThemeTagline(name);
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
  let saved = "pur";
  try { saved = localStorage.getItem("money-theme") || "pur"; } catch (e) {}
  document.documentElement.dataset.theme = THEME_LABELS[saved] ? saved : "pur";
  if (document.getElementById("theme-current")) document.getElementById("theme-current").textContent = THEME_LABELS[document.documentElement.dataset.theme];
  applyThemeSub(document.documentElement.dataset.theme);
  document.querySelectorAll(".theme-opt").forEach((o) => o.setAttribute("aria-current", o.dataset.theme === document.documentElement.dataset.theme ? "true" : "false"));
}

/* ============================================================
   boot
   ============================================================ */
const fetchJson = async (url) => { try { return await (await fetch(url, { cache: "no-store" })).json(); } catch (e) { return null; } };

async function loadLiveData() {
  const [data, intraday, daily] = await Promise.all([fetchJson("data.json"), fetchJson("intraday.json"), fetchJson("daily.json")]);
  if (data) DATA = data;
  INTRADAY = intraday; DAILY = daily;
  if (DATA) {
    const el = document.getElementById("lastUpdate");
    if (el) el.textContent = DATA.lastUpdateTime
      ? new Date(DATA.lastUpdateTime).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : new Date(DATA.lastUpdate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  }
  renderFreshness();
}

async function boot() {
  await loadLiveData();
  if (!DATA) { document.querySelector(".wrap").innerHTML = `<div class="card"><h2 class="card-title">⚠️ data.json introuvable</h2></div>`; return; }
  BENCH = (await fetchJson("benchmarks.json")) || {};
  RECAP = await fetchJson("recap.json");
  HISTORY = await fetchJson("history.json");
  renderRecap();
  wirePosModal();
  // fraîcheur : recompte les minutes chaque minute ; re-fetch les données toutes les 5 min
  setInterval(renderFreshness, 60000);
  setInterval(async () => { await loadLiveData(); if (DATA) renderAll(); }, 300000);
  wireTheme();
  wireTabBar("#bench-tabs", (tab) => { currentBench = tab.dataset.bench; });
  wireTabBar("#account-tabs", (tab) => { currentAccount = tab.dataset.acc; });
  wireTabBar("#range-tabs", (tab) => { currentRange = +tab.dataset.range; });
  wireTabBar("#forecast-tabs", (tab) => { forecastYears = +tab.dataset.years; });
  const goalInput = document.getElementById("goal-monthly");
  if (goalInput) goalInput.addEventListener("input", () => {
    try { localStorage.setItem("money-goal", String(Math.max(0, +goalInput.value || 0))); } catch (e) {}
    if (DATA) renderDiscipline();
  });
  ["forecast-monthly", "forecast-rate", "forecast-infl", "forecast-div"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => { if (DATA) renderForecast(); });
    if (el && el.type === "checkbox") el.addEventListener("change", () => { if (DATA) renderForecast(); });
  });
  wirePositionsSort();
  wireMlg();
  renderAll();
  renderNews();
}
document.addEventListener("DOMContentLoaded", boot);

// PWA : service worker (installable, plein écran sur l'écran d'accueil)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
