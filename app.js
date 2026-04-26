const state = {
  actualData: [],
  anteriorData: []
};

const REQUIRED_COLUMNS = [
  "comitente", "cuenta", "Es Juridica", "arancel",
  "AUM en Dolares", "cv7000", "$ Operables CI",
  "MEP Operables CI", "Comision 180", "Tipo Cbio MEP"
];

const VIEWS = {
  dashboard:   { title: "Dashboard",      subtitle: "Visión general del portfolio" },
  liquidez:    { title: "Liquidez",        subtitle: "Clientes ordenados por efectivo disponible" },
  aum:         { title: "Top AUM",         subtitle: "Principales clientes por activos bajo gestión" },
  inactivos:   { title: "Clientes inactivos", subtitle: "Oportunidades de reactivación" },
  comparacion: { title: "Comparación AUM", subtitle: "Evolución respecto al período anterior" }
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fileActual").addEventListener("change", e => handleFile(e, "actual"));
  document.getElementById("fileAnterior").addEventListener("change", e => handleFile(e, "anterior"));
  document.getElementById("btnExportPdf").addEventListener("click", () => window.print());

  ["filtroJuridica","filtroArancel","filtroCliente","filtroTopN"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderDashboard);
    document.getElementById(id).addEventListener("change", renderDashboard);
  });

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
});

function switchView(view) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view-section").forEach(s => s.classList.add("hidden"));
  const section = document.getElementById("view" + capitalize(view));
  if (section) section.classList.remove("hidden");
  document.getElementById("viewTitle").textContent = VIEWS[view].title;
  document.getElementById("viewSubtitle").textContent = VIEWS[view].subtitle;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function normalizeText(v) { return (v ?? "").toString().trim(); }

function normalizeNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function handleFile(e, mode) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!json.length) { showToast("El archivo no tiene datos.", "error"); return; }
    validateColumns(json[0]);

    const rows = json.map(r => ({
      comitente:      normalizeText(r["comitente"]),
      cuenta:         normalizeText(r["cuenta"]),
      esJuridica:     normalizeText(r["Es Juridica"]),
      arancel:        normalizeText(r["arancel"]),
      aum:            normalizeNumber(r["AUM en Dolares"]),
      cv7000:         normalizeNumber(r["cv7000"]),
      pesosOperables: normalizeNumber(r["$ Operables CI"]),
      mepOperables:   normalizeNumber(r["MEP Operables CI"]),
      comision180:    normalizeNumber(r["Comision 180"]),
      tipoCbioMep:    normalizeNumber(r["Tipo Cbio MEP"])
    }));

    if (mode === "actual") {
      state.actualData = rows;
      const dot = document.getElementById("dotActual");
      dot.classList.add("active");
      document.getElementById("labelActual").textContent = file.name;
      populateArancelFilter(rows);
      showToast(`Excel cargado: ${rows.length} clientes`, "success");
    } else {
      state.anteriorData = rows;
      const dot = document.getElementById("dotAnterior");
      dot.classList.add("secondary");
      document.getElementById("labelAnterior").textContent = file.name;
      showToast(`Excel anterior: ${rows.length} registros`, "success");
    }

    renderDashboard();
  } catch (err) {
    showToast(err.message || "Error al procesar el archivo.", "error");
    console.error(err);
  }
}

function validateColumns(row) {
  const cols = Object.keys(row);
  const missing = REQUIRED_COLUMNS.filter(c => !cols.includes(c));
  if (missing.length) throw new Error("Faltan columnas: " + missing.join(", "));
}

function calcRoa(row) {
  if (!row.aum || row.aum <= 0) return null;
  return ((row.comision180 * 2) / row.aum) * 100;
}

function benchmarkAnual(aum) { return aum * 0.015; }
function benchmarkMensual(aum) { return benchmarkAnual(aum) / 12; }

function roaClass(roa) {
  if (roa === null || !Number.isFinite(roa)) return "roa-sin-dato";
  if (roa < 1.1)  return "roa-rojo";
  if (roa < 1.3)  return "roa-amarillo";
  if (roa <= 2.0) return "roa-verde";
  return "roa-alto";
}

function populateArancelFilter(rows) {
  const select = document.getElementById("filtroArancel");
  const curr = select.value;
  const aranceles = [...new Set(rows.map(r => r.arancel).filter(Boolean))].sort();
  select.innerHTML = `<option value="TODOS">Todos</option>` +
    aranceles.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  if (aranceles.includes(curr)) select.value = curr;
}

function getFilteredData() {
  const jur     = document.getElementById("filtroJuridica").value;
  const arancel = document.getElementById("filtroArancel").value;
  const q       = document.getElementById("filtroCliente").value.trim().toUpperCase();

  return state.actualData.filter(r => {
    const okJ = jur     === "TODAS" || r.esJuridica === jur;
    const okA = arancel === "TODOS" || r.arancel === arancel;
    const okQ = !q || `${r.cuenta} ${r.comitente}`.toUpperCase().includes(q);
    return okJ && okA && okQ;
  });
}

function renderDashboard() {
  if (!state.actualData.length) return;

  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("dashboardContent").classList.remove("hidden");

  const topN = Number(document.getElementById("filtroTopN").value) || 15;

  const rows = getFilteredData().map(r => {
    const pesosUsd    = r.tipoCbioMep > 0 ? (r.pesosOperables / r.tipoCbioMep) : 0;
    const liquidez    = r.cv7000 + pesosUsd + r.mepOperables;
    const roa         = calcRoa(r);
    return { ...r, pesosUsd, liquidez, roa, benchMens: benchmarkMensual(r.aum) };
  });

  document.getElementById("recordCount").textContent = `${rows.length} registros`;

  updateKpis(rows, topN);
  updateRoaBands(rows);
  renderLiquidezTable(rows, topN);
  renderTopAumTable(rows, topN);
  renderInactivosTable(rows);
  renderComparacion(rows, topN);
}

function updateKpis(rows) {
  const n          = rows.length;
  const juridicas  = rows.filter(r => r.esJuridica === "1").length;
  const noJur      = rows.filter(r => r.esJuridica === "0").length;
  const totalAum   = sum(rows, "aum");
  const totalLiq   = sum(rows, "liquidez");
  const totalCom   = sum(rows, "comision180");
  const inactivos  = rows.filter(r => r.comision180 < 15).length;
  const roa        = totalAum > 0 ? ((totalCom * 2) / totalAum) * 100 : null;

  setText("kpiClientes",        fmt(n));
  setText("kpiJuridicas",       fmt(juridicas));
  setText("kpiNoJuridicas",     fmt(noJur));
  setText("kpiAum",             fmtUSD(totalAum));
  setText("kpiLiquidez",        fmtUSD(totalLiq));
  setText("kpiComision",        fmtUSD(totalCom));
  setText("kpiInactivos",       fmt(inactivos));
  setText("kpiRoa",             fmtPct(roa));
  setText("kpiBenchmarkAnual",  fmtUSD(benchmarkAnual(totalAum)));
  setText("kpiBenchmarkMensual",fmtUSD(benchmarkMensual(totalAum)));
}

function updateRoaBands(rows) {
  let rojo = 0, ambar = 0, verde = 0, alto = 0, sinDato = 0;
  rows.forEach(r => {
    const cls = roaClass(r.roa);
    if (cls === "roa-rojo")      rojo++;
    else if (cls === "roa-amarillo") ambar++;
    else if (cls === "roa-verde")   verde++;
    else if (cls === "roa-alto")    alto++;
    else                            sinDato++;
  });
  const total = rows.length || 1;
  const pct = n => (n / total * 100).toFixed(1) + "%";
  document.getElementById("barRojo").style.width    = pct(rojo);
  document.getElementById("barAmbar").style.width   = pct(ambar);
  document.getElementById("barVerde").style.width   = pct(verde);
  document.getElementById("barAlto").style.width    = pct(alto);
  document.getElementById("barSinDato").style.width = pct(sinDato);
  setText("cntRojo",    rojo);
  setText("cntAmbar",   ambar);
  setText("cntVerde",   verde);
  setText("cntAlto",    alto);
  setText("cntSinDato", sinDato);
}

function renderLiquidezTable(rows, topN) {
  const top = [...rows].sort((a,b) => b.liquidez - a.liquidez).slice(0, topN);
  renderTable("tablaLiquidez", top, (row, i) => `
    <tr>
      <td class="col-rank">${i+1}</td>
      <td>${esc(row.comitente)}</td>
      <td>${esc(row.cuenta)}</td>
      <td>${esc(row.arancel)}</td>
      <td class="num">${fmtUSD(row.cv7000)}</td>
      <td class="num">${fmtUSD(row.pesosUsd)}</td>
      <td class="num">${fmtUSD(row.mepOperables)}</td>
      <td class="num">${fmtUSD(row.tipoCbioMep)}</td>
      <td class="num"><strong>${fmtUSD(row.liquidez)}</strong></td>
      <td class="num">${fmtUSD(row.comision180)}</td>
      <td class="num"><span class="roa-badge ${roaClass(row.roa)}">${fmtPct(row.roa)}</span></td>
      <td class="num">${fmtUSD(row.benchMens)}</td>
    </tr>`);
}

function renderTopAumTable(rows, topN) {
  const top = [...rows].sort((a,b) => b.aum - a.aum).slice(0, topN);
  renderTable("tablaTopAum", top, (row, i) => `
    <tr>
      <td class="col-rank">${i+1}</td>
      <td>${esc(row.comitente)}</td>
      <td>${esc(row.cuenta)}</td>
      <td>${row.esJuridica === "1" ? "Sí" : "No"}</td>
      <td>${esc(row.arancel)}</td>
      <td class="num"><strong>${fmtUSD(row.aum)}</strong></td>
      <td class="num"><span class="roa-badge ${roaClass(row.roa)}">${fmtPct(row.roa)}</span></td>
      <td class="num">${fmtUSD(row.benchMens)}</td>
    </tr>`);
}

function renderInactivosTable(rows) {
  const inac = [...rows].filter(r => r.comision180 < 15).sort((a,b) => a.comision180 - b.comision180);
  renderTable("tablaInactivos", inac, (row, i) => `
    <tr>
      <td class="col-rank">${i+1}</td>
      <td>${esc(row.comitente)}</td>
      <td>${esc(row.cuenta)}</td>
      <td>${row.esJuridica === "1" ? "Sí" : "No"}</td>
      <td>${esc(row.arancel)}</td>
      <td class="num">${fmtUSD(row.aum)}</td>
      <td class="num"><strong>${fmtUSD(row.comision180)}</strong></td>
      <td class="num">${fmtUSD(row.liquidez)}</td>
      <td class="num"><span class="roa-badge ${roaClass(row.roa)}">${fmtPct(row.roa)}</span></td>
      <td class="num">${fmtUSD(row.benchMens)}</td>
    </tr>`);
}

function renderComparacion(actualRows, topN) {
  const emptyEl   = document.getElementById("comparacionEmpty");
  const contentEl = document.getElementById("comparacionContent");

  if (!state.anteriorData.length) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    setText("kpiDeltaAum", "-");
    return;
  }

  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const anteriorMap = new Map(state.anteriorData.map(r => [r.comitente, r]));

  const merged = actualRows.map(r => {
    const prev      = anteriorMap.get(r.comitente);
    const aumPrev   = prev ? prev.aum : 0;
    const diff      = r.aum - aumPrev;
    const pct       = aumPrev !== 0 ? (diff / aumPrev) * 100 : null;
    return { comitente: r.comitente, cuenta: r.cuenta, aumPrev, aumActual: r.aum, diff, pct };
  });

  const totalDelta = merged.reduce((a,r) => a + r.diff, 0);
  const totalPrev  = merged.reduce((a,r) => a + r.aumPrev, 0);
  const totalPct   = totalPrev ? (totalDelta / totalPrev) * 100 : null;

  setText("kpiDeltaAum",     totalDelta >= 0 ? `+${fmtUSD(totalDelta)}` : fmtUSD(totalDelta));
  setText("kpiDeltaAumComp", totalDelta >= 0 ? `+${fmtUSD(totalDelta)}` : fmtUSD(totalDelta));
  setText("kpiDeltaPct",     totalPct !== null ? (totalPct >= 0 ? `+${totalPct.toFixed(1)}%` : `${totalPct.toFixed(1)}%`) : "-");

  const sorted = [...merged].sort((a,b) => b.diff - a.diff).slice(0, topN);
  renderTable("tablaComparacion", sorted, (row, i) => {
    const sign    = row.diff >= 0;
    const cls     = sign ? "delta-pos" : "delta-neg";
    const diffStr = sign ? `+${fmtUSD(row.diff)}` : fmtUSD(row.diff);
    const pctStr  = row.pct !== null ? (row.pct >= 0 ? `+${row.pct.toFixed(1)}%` : `${row.pct.toFixed(1)}%`) : "-";
    return `<tr>
      <td class="col-rank">${i+1}</td>
      <td>${esc(row.comitente)}</td>
      <td>${esc(row.cuenta)}</td>
      <td class="num">${fmtUSD(row.aumPrev)}</td>
      <td class="num">${fmtUSD(row.aumActual)}</td>
      <td class="num"><span class="delta-badge ${cls}">${diffStr}</span></td>
      <td class="num"><span class="delta-badge ${cls}">${pctStr}</span></td>
    </tr>`;
  });
}

function renderTable(id, rows, renderer) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (!tbody) return;
  tbody.innerHTML = rows.map((r, i) => renderer(r, i)).join("");
}

function sum(rows, key) { return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function fmtUSD(n) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
}
function fmtPct(n) { return (n === null || !Number.isFinite(n)) ? "-" : `${n.toFixed(1)}%`; }
function fmt(n) { return new Intl.NumberFormat("es-AR").format(n); }

function esc(v) {
  return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

let toastTimer;
function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = "toast hidden", 3500);
}
