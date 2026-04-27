'use strict';

/* ════════════════════════════════════════════
   STATE
════════════════════════════════════════════ */
const S = {
  actual:    [],   // rows for the current period
  historico: [],   // [{label, filename, rows}]
  metas: { fact: 0, aum: 0 }
};

const REQUIRED = [
  'comitente','cuenta','Es Juridica','arancel',
  'AUM en Dolares','cv7000','$ Operables CI',
  'MEP Operables CI','Comision 180','Tipo Cbio MEP'
];

const VIEWS = {
  dashboard:  { title: 'Dashboard',        sub: 'Visión general del portfolio' },
  alertas:    { title: 'Alertas',           sub: 'Situaciones que requieren atención' },
  objetivos:  { title: 'Objetivos',         sub: 'Progreso hacia metas de facturación y AUM' },
  potencial:  { title: 'Potencial sin activar', sub: 'Clientes con mayor oportunidad de crecimiento' },
  liquidez:   { title: 'Liquidez',          sub: 'Clientes ordenados por efectivo disponible' },
  aum:        { title: 'Top AUM',           sub: 'Principales clientes por activos bajo gestión' },
  inactivos:  { title: 'Inactivos',         sub: 'Clientes con comisión menor a USD 15' },
  historico:  { title: 'Histórico',         sub: 'Evolución del portfolio en el tiempo' },
};

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadMetas();

  // file inputs
  id('fileActual').addEventListener('change', e => handleFile(e, 'actual'));
  id('fileActualEmpty').addEventListener('change', e => handleFile(e, 'actual'));
  id('fileHistorico').addEventListener('change', e => handleFile(e, 'historico'));
  id('btnClearHistorico').addEventListener('click', clearHistorico);
  id('btnExportPdf').addEventListener('click', () => window.print());
  id('btnSaveMetas').addEventListener('click', saveMetas);

  // filters
  ['filtroJuridica','filtroArancel','filtroCliente','filtroTopN'].forEach(fid => {
    id(fid).addEventListener('input', renderAll);
    id(fid).addEventListener('change', renderAll);
  });

  // nav
  qAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
});

/* ════════════════════════════════════════════
   FILE HANDLING
════════════════════════════════════════════ */
async function handleFile(e, mode) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!json.length) { toast('El archivo no tiene datos.', 'err'); return; }
    validateCols(json[0]);
    const rows = json.map(parseRow);

    if (mode === 'actual') {
      S.actual = rows;
      id('dotActual').classList.add('on');
      id('labelActual').textContent = file.name;
      populateArancelFilter(rows);
      toast(`✓ ${rows.length} clientes cargados`, 'ok');
    } else {
      const n = S.historico.length + 1;
      const label = `Excel ${n}`;
      S.historico.push({ label, filename: file.name, rows, order: n });
      toast(`Período agregado al histórico (${S.historico.length} total)`, 'ok');
    }
    renderAll();
  } catch (err) {
    toast(err.message || 'Error al procesar el archivo.', 'err');
  }
}

function validateCols(row) {
  const missing = REQUIRED.filter(c => !(c in row));
  if (missing.length) throw new Error('Faltan columnas: ' + missing.join(', '));
}

function parseRow(r) {
  return {
    comitente:  str(r['comitente']),
    cuenta:     str(r['cuenta']),
    esJuridica: str(r['Es Juridica']),
    arancel:    str(r['arancel']),
    aum:        num(r['AUM en Dolares']),
    cv7000:     num(r['cv7000']),
    pesosOp:    num(r['$ Operables CI']),
    mepOp:      num(r['MEP Operables CI']),
    comision:   num(r['Comision 180']),
    tcMep:      num(r['Tipo Cbio MEP']),
  };
}

function enrich(r) {
  const pesosUsd  = r.tcMep > 0 ? r.pesosOp / r.tcMep : 0;
  const liquidez  = r.cv7000 + pesosUsd + r.mepOp;
  const roa       = (r.aum > 0) ? (r.comision * 2 / r.aum) * 100 : null;
  const benchAn   = r.aum * 0.015;
  const benchMens = benchAn / 12;
  const roaGap    = (roa !== null) ? Math.max(0, 1.5 - roa) : 1.5;
  const potFact   = r.aum * (roaGap / 100);
  const score     = potFact;
  return { ...r, pesosUsd, liquidez, roa, benchAn, benchMens, potFact, score };
}

/* ════════════════════════════════════════════
   FILTERING
════════════════════════════════════════════ */
function getFiltered() {
  const jur  = id('filtroJuridica').value;
  const aran = id('filtroArancel').value;
  const q    = id('filtroCliente').value.trim().toUpperCase();
  return S.actual
    .filter(r =>
      (jur  === 'TODAS' || r.esJuridica === jur) &&
      (aran === 'TODOS' || r.arancel === aran) &&
      (!q   || `${r.cuenta} ${r.comitente}`.toUpperCase().includes(q))
    )
    .map(enrich);
}

function getTopN() { return Number(id('filtroTopN').value) || 15; }

function populateArancelFilter(rows) {
  const sel  = id('filtroArancel');
  const prev = sel.value;
  const opts = [...new Set(rows.map(r => r.arancel).filter(Boolean))].sort();
  sel.innerHTML = '<option value="TODOS">Todos los aranceles</option>' +
    opts.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  if (opts.includes(prev)) sel.value = prev;
}

/* ════════════════════════════════════════════
   RENDER CONTROLLER
════════════════════════════════════════════ */
function renderAll() {
  if (!S.actual.length) return;
  id('emptyState').classList.add('hidden');
  id('appContent').classList.remove('hidden');

  const rows = getFiltered();
  const topN = getTopN();

  renderKpiStrip(rows);
  renderRoaBands(rows);
  renderPotencialSummary(rows);
  renderAlertas(rows);
  renderObjetivos(rows);
  renderPotencialTable(rows, topN);
  renderLiquidez(rows, topN);
  renderTopAum(rows, topN);
  renderInactivos(rows);
  renderHistorico();
  renderCharts(rows);
}

/* ════════════════════════════════════════════
   KPI STRIP
════════════════════════════════════════════ */
function renderKpiStrip(rows) {
  const aum  = sum(rows, 'aum');
  const liq  = sum(rows, 'liquidez');
  const com  = sum(rows, 'comision');
  const inac = rows.filter(r => r.comision < 15).length;
  const roa  = aum > 0 ? (com * 2 / aum) * 100 : null;

  setText('kpiClientes', fmt(rows.length));
  setText('kpiJurid',    fmt(rows.filter(r => r.esJuridica === '1').length));
  setText('kpiNoJurid',  fmt(rows.filter(r => r.esJuridica === '0').length));
  setText('kpiAum',      fmtUSD(aum));
  setText('kpiLiquidez', fmtUSD(liq));
  setText('kpiComision', fmtUSD(com));
  setText('kpiInactivos',fmt(inac));
  setText('kpiRoa',      fmtPct(roa));
  setText('kpiBenchAnual', fmtUSD(aum * 0.015));
  setText('kpiBenchMens',  fmtUSD(aum * 0.015 / 12));
}

/* ════════════════════════════════════════════
   ROA BANDS
════════════════════════════════════════════ */
function renderRoaBands(rows) {
  let alto=0, verde=0, ambar=0, rojo=0, nd=0;
  rows.forEach(r => {
    const c = roaClass(r.roa);
    if (c==='rb-alto') alto++; else if (c==='rb-verde') verde++;
    else if (c==='rb-ambar') ambar++; else if (c==='rb-rojo') rojo++; else nd++;
  });
  const total = rows.length || 1;
  const pct   = n => (n/total*100).toFixed(1) + '%';
  id('bAlto').style.width    = pct(alto);
  id('bVerde').style.width   = pct(verde);
  id('bAmbar').style.width   = pct(ambar);
  id('bRojo').style.width    = pct(rojo);
  id('bSinDato').style.width = pct(nd);
  setText('nAlto',    alto);
  setText('nVerde',   verde);
  setText('nAmbar',   ambar);
  setText('nRojo',    rojo);
  setText('nSinDato', nd);
}

/* ════════════════════════════════════════════
   POTENCIAL SUMMARY (dashboard card)
════════════════════════════════════════════ */
function renderPotencialSummary(rows) {
  const highPot = rows.filter(r => r.score > 0 && (r.roa === null || r.roa < 1.5));
  const totalPotAum  = sum(highPot, 'aum');
  const totalPotFact = sum(highPot, 'potFact');
  setText('potClientes',  fmt(highPot.length));
  setText('potAum',       fmtUSD(totalPotAum));
  setText('potFact',      '+ ' + fmtUSD(totalPotFact));
  setText('potFactMens',  '+ ' + fmtUSD(totalPotFact / 12));
}

/* ════════════════════════════════════════════
   ALERTAS
════════════════════════════════════════════ */
function renderAlertas(rows) {
  const alerts = buildAlertas(rows);
  const badge  = id('badgeAlertas');

  const urgent = alerts.filter(a => a.level === 'high').length;
  badge.textContent = alerts.length;
  badge.classList.toggle('hidden', alerts.length === 0);

  const container = id('alertasContainer');
  if (!alerts.length) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">
      <div style="font-size:32px;margin-bottom:12px">✓</div>
      <p style="font-size:14px;color:var(--text2)">Sin alertas activas</p>
    </div>`;
    return;
  }

  // group by level
  const groups = [
    { key: 'high',   label: '🔴 Urgente' },
    { key: 'medium', label: '🟡 Atención' },
    { key: 'low',    label: '🔵 Informativo' },
    { key: 'info',   label: '🩵 Oportunidad' },
  ];

  container.innerHTML = groups
    .filter(g => alerts.some(a => a.level === g.key))
    .map(g => {
      const items = alerts.filter(a => a.level === g.key);
      return `<div class="alerta-section-title">${g.label}</div>` +
        items.map(a => `
          <div class="alerta-card ${a.level}">
            <div class="alerta-icon ${a.level}">${a.icon}</div>
            <div class="alerta-body">
              <div class="alerta-title">${a.title}</div>
              <div class="alerta-desc">${a.desc}</div>
            </div>
            <span class="alerta-tag ${a.level}">${a.tag}</span>
          </div>`).join('');
    }).join('');
}

function buildAlertas(rows) {
  const alerts = [];
  const aum      = sum(rows, 'aum');
  const com      = sum(rows, 'comision');
  const roa      = aum > 0 ? (com * 2 / aum) * 100 : null;
  const inactivos = rows.filter(r => r.comision < 15);
  const roaBajo   = rows.filter(r => r.roa !== null && r.roa < 1.1);
  const roaMedio  = rows.filter(r => r.roa !== null && r.roa >= 1.1 && r.roa < 1.3);
  const altaLiquidezBajaFact = rows.filter(r => r.liquidez > 50000 && r.comision < 15);
  const altaAumBajoRoa = rows.filter(r => r.aum > 100000 && r.roa !== null && r.roa < 1.1);

  // HIGH
  if (altaAumBajoRoa.length > 0) {
    const potencial = sum(altaAumBajoRoa, 'aum') * (1.5 - altaAumBajoRoa.reduce((a,r)=>(a + (r.roa||0)),0)/altaAumBajoRoa.length) / 100;
    alerts.push({
      level: 'high', icon: '⚠️', tag: 'Urgente',
      title: `${altaAumBajoRoa.length} cliente${altaAumBajoRoa.length>1?'s':''} con AUM >100k y ROA bajo`,
      desc: `AUM total afectado: USD ${fmtUSD(sum(altaAumBajoRoa,'aum'))}. Facturación anual potencial perdida estimada: USD ${fmtUSD(potencial)}.`
    });
  }

  if (roa !== null && roa < 1.0) {
    alerts.push({
      level: 'high', icon: '📉', tag: 'Urgente',
      title: 'ROA de cartera total por debajo de 1%',
      desc: `El ROA anualizado del portfolio filtrado es ${fmtPct(roa)}, muy por debajo del benchmark de 1,5%.`
    });
  }

  // MEDIUM
  if (inactivos.length > 0) {
    alerts.push({
      level: 'medium', icon: '⏱️', tag: 'Atención',
      title: `${inactivos.length} cliente${inactivos.length>1?'s':''} inactivo${inactivos.length>1?'s':''}`,
      desc: `Comisión 180 menor a USD 15. AUM total de este grupo: USD ${fmtUSD(sum(inactivos,'aum'))}.`
    });
  }

  if (roaBajo.length > 0 && altaAumBajoRoa.length === 0) {
    alerts.push({
      level: 'medium', icon: '🎯', tag: 'Atención',
      title: `${roaBajo.length} cliente${roaBajo.length>1?'s':''} con ROA bajo (< 1,1%)`,
      desc: `Oportunidad de mejorar facturación. AUM combinado: USD ${fmtUSD(sum(roaBajo,'aum'))}.`
    });
  }

  if (roa !== null && roa >= 1.0 && roa < 1.3) {
    alerts.push({
      level: 'medium', icon: '📊', tag: 'Atención',
      title: 'ROA de cartera debajo del benchmark',
      desc: `ROA actual: ${fmtPct(roa)}. El objetivo es 1,5% anual. Diferencia: ${fmtPct(1.5 - roa)}.`
    });
  }

  // INFO / OPPORTUNITY
  if (altaLiquidezBajaFact.length > 0) {
    alerts.push({
      level: 'info', icon: '💧', tag: 'Oportunidad',
      title: `${altaLiquidezBajaFact.length} cliente${altaLiquidezBajaFact.length>1?'s':''} con alta liquidez sin facturación`,
      desc: `Liquidez total disponible: USD ${fmtUSD(sum(altaLiquidezBajaFact,'liquidez'))}. Alta oportunidad de conversión a AUM invertido.`
    });
  }

  if (roaMedio.length > 0) {
    alerts.push({
      level: 'low', icon: '📈', tag: 'Informativo',
      title: `${roaMedio.length} cliente${roaMedio.length>1?'s':''} en ROA medio (1,1–1,3%)`,
      desc: `Con acciones concretas estos clientes pueden alcanzar el benchmark. AUM: USD ${fmtUSD(sum(roaMedio,'aum'))}.`
    });
  }

  // Metas
  if (S.metas.fact > 0) {
    const factAnual = com * 2;
    const pct = factAnual / S.metas.fact * 100;
    if (pct < 70) {
      alerts.push({
        level: 'medium', icon: '🏆', tag: 'Meta',
        title: `Facturación al ${pct.toFixed(0)}% de la meta anual`,
        desc: `Facturación anualizada actual: USD ${fmtUSD(factAnual)}. Meta: USD ${fmtUSD(S.metas.fact)}. Falta: USD ${fmtUSD(S.metas.fact - factAnual)}.`
      });
    } else if (pct >= 100) {
      alerts.push({
        level: 'info', icon: '🎉', tag: 'Meta',
        title: '¡Meta de facturación alcanzada!',
        desc: `Facturación anualizada: USD ${fmtUSD(factAnual)} (${pct.toFixed(0)}% de la meta).`
      });
    }
  }

  return alerts;
}

/* ════════════════════════════════════════════
   OBJETIVOS
════════════════════════════════════════════ */
function renderObjetivos(rows) {
  const aum     = sum(rows, 'aum');
  const com     = sum(rows, 'comision');
  const factAn  = com * 2;
  const activos = rows.filter(r => r.comision >= 15).length;

  setText('objFactActual', fmtUSD(factAn));
  setText('objAumActual',  fmtUSD(aum));
  setText('objClientesActivos', fmt(activos));

  const mFact = S.metas.fact || 0;
  const mAum  = S.metas.aum  || 0;

  setText('objFactMeta', mFact ? fmtUSD(mFact) : '—');
  setText('objAumMeta',  mAum  ? fmtUSD(mAum)  : '—');

  const pctFact = mFact ? Math.min(factAn / mFact * 100, 100) : 0;
  const pctAum  = mAum  ? Math.min(aum    / mAum  * 100, 100) : 0;

  id('progFact').style.width = pctFact.toFixed(1) + '%';
  id('progAum').style.width  = pctAum.toFixed(1)  + '%';

  setText('objFactPct',  mFact ? pctFact.toFixed(1) + '%' : '—');
  setText('objAumPct',   mAum  ? pctAum.toFixed(1)  + '%' : '—');
  setText('objFactFalta', mFact ? fmtUSD(Math.max(0, mFact - factAn)) : '—');
  setText('objAumFalta',  mAum  ? fmtUSD(Math.max(0, mAum  - aum))   : '—');

  // Clientes necesarios para meta (si la meta es mayor a lo actual)
  const factPorCliente = activos > 0 ? factAn / activos : 0;
  const clientesMeta   = mFact && factPorCliente > 0 ? Math.ceil(mFact / factPorCliente) : '—';
  setText('objClientesMeta', typeof clientesMeta === 'number' ? fmt(clientesMeta) : clientesMeta);

  // Insights
  const insights = [];
  if (!mFact && !mAum) {
    insights.push('Configurá tus metas arriba para ver los insights de cierre.');
  } else {
    if (mFact && factAn < mFact) {
      const faltaFact = mFact - factAn;
      const clientesExtraFact = factPorCliente > 0 ? Math.ceil(faltaFact / factPorCliente) : '?';
      insights.push(`Para alcanzar la meta de facturación necesitás USD ${fmtUSD(faltaFact)} adicionales. Con el ticket promedio actual (USD ${fmtUSD(factPorCliente / activos || 0)} por cliente) se necesitarían ${clientesExtraFact} clientes nuevos activos.`);
      const aumNecesario = (faltaFact / 0.015);
      insights.push(`Alternativamente, llevar ${fmtUSD(aumNecesario)} en AUM al benchmark del 1,5% cubriría el faltante de facturación.`);
    }
    if (mAum && aum < mAum) {
      insights.push(`Para alcanzar la meta de AUM necesitás incorporar USD ${fmtUSD(mAum - aum)} adicionales bajo gestión.`);
    }
    const potenciales = rows.filter(r => r.score > 0 && (r.roa === null || r.roa < 1.5));
    if (potenciales.length > 0) {
      const totalPot = sum(potenciales, 'potFact');
      insights.push(`Hay ${potenciales.length} clientes con facturación potencial sin activar por USD ${fmtUSD(totalPot)} anuales. Priorizalos en la sección Potencial.`);
    }
  }

  id('insightMetas').innerHTML = insights.map(t =>
    `<div class="insight-row">${t}</div>`).join('');
}

function saveMetas() {
  const f = Number(id('metaFact').value) || 0;
  const a = Number(id('metaAum').value)  || 0;
  S.metas = { fact: f, aum: a };
  try { localStorage.setItem('ifa_metas', JSON.stringify(S.metas)); } catch(e) {}
  toast('Metas guardadas', 'ok');
  renderAll();
}

function loadMetas() {
  try {
    const d = JSON.parse(localStorage.getItem('ifa_metas') || 'null');
    if (d) {
      S.metas = d;
      if (d.fact) id('metaFact').value = d.fact;
      if (d.aum)  id('metaAum').value  = d.aum;
    }
  } catch(e) {}
}

/* ════════════════════════════════════════════
   POTENCIAL TABLE
════════════════════════════════════════════ */
function renderPotencialTable(rows, topN) {
  const eligible = rows
    .filter(r => r.aum > 0 && (r.roa === null || r.roa < 1.5))
    .sort((a,b) => b.score - a.score)
    .slice(0, topN);

  const totalPotFact = sum(eligible, 'potFact');
  const totalPotAum  = sum(eligible, 'aum');

  setText('potTotalClientes', fmt(eligible.length));
  setText('potTotalAum',      fmtUSD(totalPotAum));
  setText('potTotalFact',     '+ ' + fmtUSD(totalPotFact));
  setText('potTotalFactMens', '+ ' + fmtUSD(totalPotFact / 12));

  renderTable('tablaPotencial', eligible, (r, i) => {
    const priority = r.score > 5000 ? 'Alta' : r.score > 1000 ? 'Media' : 'Baja';
    const pClass   = r.score > 5000 ? 'sb-alta' : r.score > 1000 ? 'sb-media' : 'sb-baja';
    const gap      = r.roa !== null ? fmtPct(Math.max(0, 1.5 - r.roa)) : '1,5%';
    return `<tr>
      <td class="tc">${i+1}</td>
      <td>${esc(r.comitente)}</td>
      <td>${esc(r.cuenta)}</td>
      <td>${esc(r.arancel)}</td>
      <td class="tr">${fmtUSD(r.aum)}</td>
      <td class="tr"><span class="roa-badge ${roaClass(r.roa)}">${fmtPct(r.roa)}</span></td>
      <td class="tr">${gap}</td>
      <td class="tr"><strong>+ ${fmtUSD(r.potFact)}</strong></td>
      <td class="tr">+ ${fmtUSD(r.potFact / 12)}</td>
      <td class="tr">${fmtUSD(r.score)}</td>
      <td class="tc"><span class="score-badge ${pClass}">${priority}</span></td>
    </tr>`;
  });
}

/* ════════════════════════════════════════════
   LIQUIDEZ TABLE
════════════════════════════════════════════ */
function renderLiquidez(rows, topN) {
  const top = [...rows].sort((a,b) => b.liquidez - a.liquidez).slice(0, topN);
  renderTable('tablaLiquidez', top, (r,i) => `<tr>
    <td class="tc">${i+1}</td>
    <td>${esc(r.comitente)}</td><td>${esc(r.cuenta)}</td><td>${esc(r.arancel)}</td>
    <td class="tr">${fmtUSD(r.cv7000)}</td>
    <td class="tr">${fmtUSD(r.pesosUsd)}</td>
    <td class="tr">${fmtUSD(r.mepOp)}</td>
    <td class="tr">${fmtUSD(r.tcMep)}</td>
    <td class="tr"><strong>${fmtUSD(r.liquidez)}</strong></td>
    <td class="tr">${fmtUSD(r.comision)}</td>
    <td class="tr"><span class="roa-badge ${roaClass(r.roa)}">${fmtPct(r.roa)}</span></td>
    <td class="tr">${fmtUSD(r.benchMens)}</td>
  </tr>`);
}

/* ════════════════════════════════════════════
   TOP AUM TABLE
════════════════════════════════════════════ */
function renderTopAum(rows, topN) {
  const top = [...rows].sort((a,b) => b.aum - a.aum).slice(0, topN);
  renderTable('tablaTopAum', top, (r,i) => `<tr>
    <td class="tc">${i+1}</td>
    <td>${esc(r.comitente)}</td><td>${esc(r.cuenta)}</td>
    <td>${r.esJuridica==='1'?'Sí':'No'}</td>
    <td>${esc(r.arancel)}</td>
    <td class="tr"><strong>${fmtUSD(r.aum)}</strong></td>
    <td class="tr"><span class="roa-badge ${roaClass(r.roa)}">${fmtPct(r.roa)}</span></td>
    <td class="tr">${fmtUSD(r.benchMens)}</td>
  </tr>`);
}

/* ════════════════════════════════════════════
   INACTIVOS TABLE
════════════════════════════════════════════ */
function renderInactivos(rows) {
  const inac = [...rows].filter(r => r.comision < 15).sort((a,b) => a.comision - b.comision);
  renderTable('tablaInactivos', inac, (r,i) => `<tr>
    <td class="tc">${i+1}</td>
    <td>${esc(r.comitente)}</td><td>${esc(r.cuenta)}</td>
    <td>${r.esJuridica==='1'?'Sí':'No'}</td>
    <td>${esc(r.arancel)}</td>
    <td class="tr">${fmtUSD(r.aum)}</td>
    <td class="tr"><strong>${fmtUSD(r.comision)}</strong></td>
    <td class="tr">${fmtUSD(r.liquidez)}</td>
    <td class="tr"><span class="roa-badge ${roaClass(r.roa)}">${fmtPct(r.roa)}</span></td>
    <td class="tr">${fmtUSD(r.benchMens)}</td>
  </tr>`);
}

/* ════════════════════════════════════════════
   HISTÓRICO
════════════════════════════════════════════ */
function clearHistorico() {
  if (!S.historico.length) return;
  S.historico = [];
  toast('Histórico limpiado', 'ok');
  renderHistorico();
}

function renderHistorico() {
  const empty   = id('historicoEmpty');
  const content = id('historicoContent');

  if (!S.historico.length) {
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  content.classList.remove('hidden');

  const periods = S.historico.map(p => {
    const rows    = p.rows.map(enrich);
    const aumT    = sum(rows, 'aum');
    const comT    = sum(rows, 'comision');
    const activos = rows.filter(r => r.comision >= 15).length;
    const liqT    = sum(rows, 'liquidez');
    const roa     = aumT > 0 ? (comT * 2 / aumT) * 100 : null;
    return { label: p.label, filename: p.filename, n: rows.length, activos, aum: aumT, com: comT, liq: liqT, roa };
  });

  const aumInicial = periods[0].aum;
  const aumActual  = periods[periods.length-1].aum;
  const delta      = aumActual - aumInicial;
  const deltaPct   = aumInicial ? delta/aumInicial*100 : null;

  setText('histPeriodos',   fmt(periods.length));
  setText('histAumInicial', fmtUSD(aumInicial));
  setText('histAumActual',  fmtUSD(aumActual));
  setText('histDeltaTotal', (delta>=0?'+':'') + fmtUSD(delta) + (deltaPct!==null ? ` (${deltaPct>=0?'+':''}${deltaPct.toFixed(1)}%)` : ''));

  // ── TIMELINE ──────────────────────────────
  const timelineEl = id('historicoTimeline');
  if (timelineEl) {
    const metrics = [
      { key: 'aum',     label: 'AUM',            fmt: fmtUSD, prefix: 'USD ' },
      { key: 'com',     label: 'Comisión 180d',   fmt: fmtUSD, prefix: 'USD ' },
      { key: 'activos', label: 'Clientes activos',fmt: fmt,    prefix: '' },
      { key: 'liq',     label: 'Liquidez',         fmt: fmtUSD, prefix: 'USD ' },
      { key: 'roa',     label: 'ROA anualizado',   fmt: v => fmtPct(v), prefix: '' },
    ];

    timelineEl.innerHTML = `
      <div class="timeline-wrap">
        ${periods.map((p, i) => {
          const prev = i > 0 ? periods[i-1] : null;
          const isLast = i === periods.length - 1;

          const metricRows = metrics.map(m => {
            const val  = p[m.key];
            const pval = prev ? prev[m.key] : null;
            let deltaHtml = '';
            if (prev !== null && pval !== null && val !== null) {
              const diff = val - pval;
              const pct  = pval !== 0 ? diff / Math.abs(pval) * 100 : null;
              const pos  = diff >= 0;
              const cls  = pos ? 'tl-delta-pos' : 'tl-delta-neg';
              const arrow = pos ? '▲' : '▼';
              const diffStr = m.key === 'roa'
                ? (pos?'+':'') + diff.toFixed(2) + '%'
                : (pos?'+':'') + m.fmt(Math.abs(diff));
              const pctStr = pct !== null ? ` (${pos?'+':''}${pct.toFixed(1)}%)` : '';
              deltaHtml = `<span class="${cls}">${arrow} ${diffStr}${pctStr}</span>`;
            }
            const displayVal = val === null ? '—' : (m.key === 'roa' ? fmtPct(val) : m.prefix + m.fmt(val));
            return `
              <div class="tl-metric">
                <span class="tl-metric-label">${m.label}</span>
                <span class="tl-metric-value">${displayVal}</span>
                ${deltaHtml ? `<div class="tl-metric-delta">${deltaHtml}</div>` : '<div class="tl-metric-delta"></div>'}
              </div>`;
          }).join('');

          return `
            <div class="tl-period${isLast ? ' tl-period-last' : ''}">
              <div class="tl-connector${i === 0 ? ' tl-first' : ''}">
                <div class="tl-line-left${i === 0 ? ' invisible' : ''}"></div>
                <div class="tl-dot${isLast ? ' tl-dot-active' : ''}"></div>
                <div class="tl-line-right${isLast ? ' invisible' : ''}"></div>
              </div>
              <div class="tl-card">
                <div class="tl-card-head">
                  <strong class="tl-period-label">${esc(p.label)}</strong>
                  <span class="tl-filename">${esc(p.filename)}</span>
                </div>
                <div class="tl-metrics">${metricRows}</div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── TABLE ──────────────────────────────────
  renderTable('tablaHistorico', periods, (p, i) => {
    const prev   = i > 0 ? periods[i-1] : null;
    const dAum   = prev ? p.aum - prev.aum : null;
    const dPct   = (prev && prev.aum) ? dAum/prev.aum*100 : null;
    const dClass = dAum === null ? '' : dAum >= 0 ? 'delta-pos' : 'delta-neg';
    return `<tr>
      <td><strong>${esc(p.label)}</strong></td>
      <td style="color:var(--text3);font-size:11px">${esc(p.filename)}</td>
      <td class="tr">${fmt(p.n)}</td>
      <td class="tr">${fmt(p.activos)}</td>
      <td class="tr"><strong>${fmtUSD(p.aum)}</strong></td>
      <td class="tr"><span class="${dClass}">${dAum!==null?(dAum>=0?'+':'')+fmtUSD(dAum):'—'}</span></td>
      <td class="tr"><span class="${dClass}">${dPct!==null?(dPct>=0?'+':'')+dPct.toFixed(1)+'%':'—'}</span></td>
      <td class="tr">${fmtUSD(p.com)}</td>
      <td class="tr"><span class="roa-badge ${roaClass(p.roa)}">${fmtPct(p.roa)}</span></td>
    </tr>`;
  });
}

/* ════════════════════════════════════════════
   CHARTS (SVG, sin dependencias)
════════════════════════════════════════════ */
function renderCharts(rows) {
  renderArancelChart(rows);
  renderScatterChart(rows);
  renderPiramidaChart(rows);
}

/* Bar chart: distribución por arancel */
function renderArancelChart(rows) {
  const el = id('chartArancel');
  if (!el) return;
  const byArancel = {};
  rows.forEach(r => { byArancel[r.arancel] = (byArancel[r.arancel]||0) + r.aum; });
  const entries = Object.entries(byArancel).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (!entries.length) { el.innerHTML = ''; return; }
  const max = entries[0][1];
  const colors = ['var(--blue)','var(--teal)','var(--green)','var(--amber)','var(--red)'];
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;width:100%;">` +
    entries.map(([k,v],i) => `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="width:90px;font-size:11px;color:var(--text2);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;flex-shrink:0">${esc(k)||'—'}</span>
        <div style="flex:1;height:8px;background:var(--s3);border-radius:99px;overflow:hidden;">
          <div style="width:${(v/max*100).toFixed(1)}%;height:100%;background:${colors[i%colors.length]};border-radius:99px;transition:width 0.7s cubic-bezier(0.16,1,0.3,1)"></div>
        </div>
        <span style="width:80px;text-align:right;font-size:11.5px;font-family:'DM Mono',monospace;color:var(--text)">${fmtUSD(v)}</span>
      </div>`).join('') + '</div>';
}

/* Scatter: AUM vs ROA */
function renderScatterChart(rows) {
  const el = id('chartScatter');
  if (!el) return;
  const W = 500, H = 220, PL = 52, PR = 16, PT = 12, PB = 36;
  const IW = W-PL-PR, IH = H-PT-PB;

  // Filtrar ROA outliers (>5%) — operaciones puntuales que distorsionan el eje Y
  const ROA_CAP = 5;
  const allValid = rows.filter(r => r.aum > 0 && r.roa !== null);
  const excluded = allValid.filter(r => r.roa > ROA_CAP);
  const valid    = allValid.filter(r => r.roa <= ROA_CAP);

  if (valid.length < 2) { el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px"><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="var(--text3)" font-size="12">Datos insuficientes</text></svg>`; return; }

  const maxAum = Math.max(...valid.map(r => r.aum));
  const maxRoa = Math.max(3, Math.max(...valid.map(r => r.roa)));
  const xPos   = aum => PL + (aum / maxAum) * IW;
  const yPos   = roa => PT + IH - (roa / maxRoa) * IH;

  const benchY = yPos(1.5);
  const dots   = valid.map(r => {
    const cls = roaClass(r.roa);
    const col = cls==='rb-alto'?'var(--blue)':cls==='rb-verde'?'var(--green)':cls==='rb-ambar'?'var(--amber)':'var(--red)';
    const r2  = Math.max(3, Math.min(8, r.aum/maxAum*10 + 2));
    return `<circle cx="${xPos(r.aum).toFixed(1)}" cy="${yPos(r.roa).toFixed(1)}" r="${r2.toFixed(1)}" fill="${col}" opacity="0.75">
      <title>${esc(r.comitente)} · AUM ${fmtUSD(r.aum)} · ROA ${fmtPct(r.roa)}</title>
    </circle>`;
  }).join('');

  // y-axis labels
  const yLabels = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0].filter(v => v <= maxRoa);
  const yAxisLines = yLabels.map(v => `
    <line x1="${PL}" y1="${yPos(v).toFixed(1)}" x2="${W-PR}" y2="${yPos(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
    <text x="${PL-6}" y="${(yPos(v)+4).toFixed(1)}" text-anchor="end" fill="var(--text3)" font-size="10">${v}%</text>`).join('');

  const excludedNote = excluded.length > 0
    ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">${excluded.length} cliente${excluded.length>1?'s':''} con ROA mayor a ${ROA_CAP}% excluido${excluded.length>1?'s':''} del gráfico (operaciones puntuales atípicas)</div>`
    : '';

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="scatter-clip"><rect x="${PL}" y="${PT}" width="${IW}" height="${IH}"/></clipPath></defs>
    ${yAxisLines}
    <line x1="${PL}" y1="${benchY.toFixed(1)}" x2="${W-PR}" y2="${benchY.toFixed(1)}" stroke="var(--green)" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7"/>
    <text x="${W-PR-2}" y="${(benchY-4).toFixed(1)}" text-anchor="end" fill="var(--green)" font-size="9" opacity="0.8">benchmark 1,5%</text>
    <g clip-path="url(#scatter-clip)">${dots}</g>
    <text x="${W/2}" y="${H-4}" text-anchor="middle" fill="var(--text3)" font-size="10">AUM</text>
    <text x="${PL-36}" y="${PT+IH/2}" text-anchor="middle" fill="var(--text3)" font-size="10" transform="rotate(-90,${PL-36},${PT+IH/2})">ROA %</text>
  </svg>${excludedNote}`;
}

/* Pirámide de clientes por rango de AUM */
function renderPiramidaChart(rows) {
  const el = id('chartPiramida');
  if (!el) return;
  const ranges = [
    { label: '> 500k',      min: 500000,  max: Infinity, color: 'var(--blue)' },
    { label: '200k – 500k', min: 200000,  max: 500000,   color: 'var(--teal)' },
    { label: '50k – 200k',  min: 50000,   max: 200000,   color: 'var(--green)' },
    { label: '10k – 50k',   min: 10000,   max: 50000,    color: 'var(--amber)' },
    { label: '< 10k',       min: 0,       max: 10000,    color: 'var(--red)' },
  ];
  const counts = ranges.map(r => ({ ...r, n: rows.filter(c => c.aum >= r.min && c.aum < r.max).length }));
  const maxN   = Math.max(...counts.map(r=>r.n), 1);

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:7px;width:100%;">` +
    counts.map(r => `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="width:100px;font-size:11px;color:var(--text2);flex-shrink:0;text-align:right">${r.label}</span>
        <div style="flex:1;height:24px;background:var(--s3);border-radius:5px;overflow:hidden;position:relative;">
          <div style="width:${(r.n/maxN*100).toFixed(1)}%;height:100%;background:${r.color};border-radius:5px;opacity:0.85;transition:width 0.7s cubic-bezier(0.16,1,0.3,1)"></div>
          ${r.n > 0 ? `<span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;font-family:'DM Mono',monospace;color:#fff;font-weight:500">${r.n} cliente${r.n!==1?'s':''}</span>` : ''}
        </div>
      </div>`).join('') + '</div>';
}

/* Line chart SVG */
function drawLineChart(containerId, labels, values, color, label) {
  const el = id(containerId);
  if (!el || values.length < 2) { if(el) el.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;width:100%">Cargá más períodos para ver la evolución</div>`; return; }

  const W=560, H=180, PL=64, PR=24, PT=28, PB=32;
  const IW=W-PL-PR, IH=H-PT-PB;

  const isNum  = typeof values[0] === 'number' && values[0] > 100;
  const fmtVal = v => isNum ? fmtUSD(v) : fmt(v);

  // Add 10% padding above/below so points never touch the edge
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin || rawMax * 0.1 || 1;
  const pad  = rawRange * 0.15;
  const minV = Math.max(0, rawMin - pad);
  const maxV = rawMax + pad;
  const range = maxV - minV || 1;

  const xPos = i => PL + (values.length > 1 ? (i / (values.length - 1)) : 0.5) * IW;
  const yPos = v => PT + IH - ((v - minV) / range) * IH;

  // Y-axis gridlines — 3 nice levels
  const niceStep = v => {
    const mag = Math.pow(10, Math.floor(Math.log10(v || 1)));
    const norm = v / mag;
    const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return nice * mag;
  };
  const step = niceStep((rawMax - rawMin) / 3 || rawMax / 3 || 1);
  const gridStart = Math.ceil(rawMin / step) * step;
  const gridVals = [];
  for (let v = gridStart; v <= rawMax + step * 0.1; v += step) gridVals.push(v);

  const gridLines = gridVals.map(v => `
    <line x1="${PL}" y1="${yPos(v).toFixed(1)}" x2="${W-PR}" y2="${yPos(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
    <text x="${PL-6}" y="${(yPos(v)+3.5).toFixed(1)}" text-anchor="end" fill="var(--text3)" font-size="9">${fmtVal(v)}</text>`).join('');

  const pts  = values.map((v,i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');
  const area = `${xPos(0)},${PT+IH} ` + values.map((v,i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ') + ` ${xPos(values.length-1)},${PT+IH}`;

  // Value labels above each dot
  const valueLabels = values.map((v,i) => {
    const cx = xPos(i), cy = yPos(v);
    return `<text x="${cx.toFixed(1)}" y="${(cy-8).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="9.5" font-weight="600" opacity="0.9">${fmtVal(v)}</text>`;
  }).join('');

  const dots = values.map((v,i) => `
    <circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="4.5" fill="${color}" stroke="var(--s1)" stroke-width="2.5">
      <title>${labels[i]}: ${fmtVal(v)}</title>
    </circle>`).join('');

  const xlabs = labels.map((l,i) =>
    `<text x="${xPos(i).toFixed(1)}" y="${H-8}" text-anchor="middle" fill="var(--text2)" font-size="10.5" font-weight="500">${l}</text>`).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="lg-${containerId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="clip-${containerId}">
        <rect x="${PL}" y="${PT}" width="${IW}" height="${IH}"/>
      </clipPath>
    </defs>
    ${gridLines}
    <g clip-path="url(#clip-${containerId})">
      <polygon points="${area}" fill="url(#lg-${containerId})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    </g>
    ${dots}
    ${valueLabels}
    ${xlabs}
  </svg>`;
}

/* ════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════ */
function switchView(view) {
  qAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  qAll('.view-section').forEach(s => s.classList.add('hidden'));
  const section = id('view' + view.charAt(0).toUpperCase() + view.slice(1));
  if (section) section.classList.remove('hidden');
  const meta = VIEWS[view] || {};
  setText('viewTitle',    meta.title || view);
  setText('viewSubtitle', meta.sub   || '');
}

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function renderTable(tableId, rows, renderer) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (tbody) tbody.innerHTML = rows.map((r,i) => renderer(r,i)).join('');
}
function sum(rows, key) { return rows.reduce((a,r) => a + (Number(r[key])||0), 0); }
function setText(eid, v) { const e = id(eid); if (e) e.textContent = v; }
function id(eid)  { return document.getElementById(eid); }
function qAll(sel){ return document.querySelectorAll(sel); }

function str(v) { return (v ?? '').toString().trim(); }
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).trim().replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n) ? n : 0;
}
function fmtUSD(n) {
  return new Intl.NumberFormat('es-AR',{minimumFractionDigits:0,maximumFractionDigits:0}).format(Math.round(Number(n)||0));
}
function fmtPct(n) { return (n===null||!Number.isFinite(n)) ? '—' : `${n.toFixed(1)}%`; }
function fmt(n)    { return new Intl.NumberFormat('es-AR').format(Number(n)||0); }
function esc(v)    { return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

function roaClass(roa) {
  if (roa===null || !Number.isFinite(roa)) return 'rb-nd';
  if (roa < 1.1)  return 'rb-rojo';
  if (roa < 1.3)  return 'rb-ambar';
  if (roa <= 2.0) return 'rb-verde';
  return 'rb-alto';
}

let toastTimer;
function toast(msg, type='') {
  const el = id('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3200);
}
