const WSS_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_DATOS = "unemi/g3/minidatacenter/datos";
const TOPIC_ESTADO = "unemi/g3/minidatacenter/estado";
const TOPIC_CONFIG = "unemi/g3/minidatacenter/config";
const STORAGE_KEY_HIST = "mdc_historial_temp_v1";
const STORAGE_KEY_CSV = "mdc_registros_csv_v1";
const MAX_PUNTOS = 60;
const MAX_REGISTROS_STORAGE = 2000;

let espOnline = false;
let ultimoMensajeMs = 0;
let historialTemp = [];
let registrosCSV = [];
let metaGrafica = null;
let rolActual = "admin";
let rolSeleccionadoModal = "espectador";

const CLASES_ESTADO = {
  NORMAL: "estado-pill estado-normal",
  ALERTA: "estado-pill estado-alerta",
  CRITICO: "estado-pill estado-critico",
  ERROR_SENSOR: "estado-pill estado-error"
};

function detectarRolInicial() {
  const params = new URLSearchParams(window.location.search);
  const rolParam = (params.get("rol") || "").toLowerCase();
  if (rolParam === "espectador" || rolParam === "viewer") {
    aplicarRol("espectador");
  } else {
    aplicarRol("admin");
  }
}

function aplicarRol(rol) {
  rolActual = rol === "espectador" ? "espectador" : "admin";
  const esEspectador = rolActual === "espectador";

  document.body.classList.toggle("solo-lectura", esEspectador);

  const idsControles = [
    "selModo",
    "selCarga",
    "inpTamb",
    "inpTon",
    "chkFalla",
    "btnReiniciar",
    "btnAplicar",
    "btnLimpiar"
  ];

  idsControles.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = esEspectador;
  });
}

function construirUrlPorRol(rol) {
  const url = new URL(window.location.href);
  if (rol === "espectador") {
    url.searchParams.set("rol", "espectador");
  } else {
    url.searchParams.set("rol", "admin");
  }
  return url.toString();
}

function abrirModalQR() {
  rolSeleccionadoModal = "espectador";
  seleccionarTabRol("espectador");
  document.getElementById("modalQR").classList.add("abierto");
}

function cerrarModalQR() {
  document.getElementById("modalQR").classList.remove("abierto");
}

function seleccionarTabRol(rol) {
  rolSeleccionadoModal = rol;
  document.getElementById("tabEspectador").classList.toggle("activo", rol === "espectador");
  document.getElementById("tabAdmin").classList.toggle("activo", rol === "admin");

  const desc = document.getElementById("qrDescripcion");
  if (rol === "espectador") {
    desc.textContent = "Modo Espectador: puede ver todos los datos en tiempo real y descargar CSV, pero no puede modificar ni controlar el sistema.";
  } else {
    desc.textContent = "Modo Administrador: acceso completo para ver datos, cambiar escenarios, controlar el ventilador y reiniciar históricos.";
  }

  const enlace = construirUrlPorRol(rol);
  document.getElementById("qrUrlInput").value = enlace;

  const canvas = document.getElementById("qrCanvas");
  if (window.QRious) {
    new QRious({
      element: canvas,
      value: enlace,
      size: 190,
      level: "M",
      background: "#ffffff",
      foreground: "#0f172a"
    });
  }
}

function copiarEnlaceRol() {
  const input = document.getElementById("qrUrlInput");
  input.select();
  input.setSelectionRange(0, 99999);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(input.value);
  } else {
    document.execCommand("copy");
  }
  const btn = document.getElementById("btnCopiarEnlace");
  btn.textContent = "Copiado";
  setTimeout(() => {
    btn.textContent = "Copiar";
  }, 1500);
}

function actualizarContadorGuardados() {
  const el = document.getElementById("contadorGuardados");
  el.textContent = `${registrosCSV.length} registros guardados`;
}

function guardarEnLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_HIST, JSON.stringify(historialTemp));
    localStorage.setItem(STORAGE_KEY_CSV, JSON.stringify(registrosCSV));
  } catch (e) {}
  actualizarContadorGuardados();
}

function cargarDesdeLocalStorage() {
  try {
    const hRaw = localStorage.getItem(STORAGE_KEY_HIST);
    const cRaw = localStorage.getItem(STORAGE_KEY_CSV);
    if (hRaw) {
      const parsedH = JSON.parse(hRaw);
      if (Array.isArray(parsedH)) historialTemp = parsedH.slice(-MAX_PUNTOS);
    }
    if (cRaw) {
      const parsedC = JSON.parse(cRaw);
      if (Array.isArray(parsedC)) registrosCSV = parsedC.slice(-MAX_REGISTROS_STORAGE);
    }
  } catch (e) {}
  actualizarContadorGuardados();
}

function limpiarAlmacenamiento() {
  if (rolActual === "espectador") return;
  historialTemp = [];
  registrosCSV = [];
  try {
    localStorage.removeItem(STORAGE_KEY_HIST);
    localStorage.removeItem(STORAGE_KEY_CSV);
  } catch (e) {}
  actualizarContadorGuardados();
  dibujarGrafica(-1);
}

function fmtNum(v, dec = 1, suf = "") {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "--";
  return `${Number(v).toFixed(dec)}${suf}`;
}

function obtenerFechaHoraActual() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return {
    legible: `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`,
    archivo: `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`,
    timestamp: now.getTime()
  };
}

function actualizarConexion(online) {
  espOnline = online;
  const el = document.getElementById("indicadorEsp");
  if (online) {
    el.classList.add("conectado");
  } else {
    el.classList.remove("conectado");
  }
}

function prepararCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(260, Math.floor(rect.width));
  const height = Math.max(190, Math.floor(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function dibujarGrafica(hoverIdx = -1) {
  const canvas = document.getElementById("graficaTemp");
  const { ctx, width, height } = prepararCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const padLeft = 46;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const plotW = Math.max(40, width - padLeft - padRight);
  const plotH = Math.max(40, height - padTop - padBottom);

  const lo = 20;
  const hi = 55;
  const yVal = (v) => padTop + plotH - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * plotH;

  ctx.font = "600 10.5px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  [20, 30, 35, 45, 55].forEach((val) => {
    const y = yVal(val);
    ctx.save();
    ctx.strokeStyle = val === 30 ? "#eab308" : val === 35 ? "#ef4444" : "#e2e8f0";
    if (val !== 20) ctx.setLineDash([4, 4]);
    ctx.lineWidth = val === 30 || val === 35 ? 1.3 : 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(`${val}°`, padLeft - 8, y);
  });

  if (historialTemp.length === 0) {
    metaGrafica = null;
    return;
  }

  const denom = Math.max(1, MAX_PUNTOS - 1);
  const coords = historialTemp.map((pt, i) => ({
    x: padLeft + (i / denom) * plotW,
    y: yVal(pt.tmax),
    tmax: pt.tmax,
    hora: pt.hora
  }));

  ctx.save();
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.stroke();
  ctx.restore();

  coords.forEach((c, i) => {
    const active = i === hoverIdx;
    ctx.beginPath();
    ctx.arc(c.x, c.y, active ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#0284c7" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0284c7";
    ctx.stroke();
  });

  metaGrafica = { padLeft, plotW, denom, coords };
}

function configurarTooltip() {
  const canvas = document.getElementById("graficaTemp");
  const tooltip = document.getElementById("tooltipTemp");

  canvas.addEventListener("mousemove", (e) => {
    if (!metaGrafica || metaGrafica.coords.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { padLeft, plotW, denom, coords } = metaGrafica;
    const rel = Math.max(0, Math.min(1, (mx - padLeft) / plotW));
    const idx = Math.min(coords.length - 1, Math.round(rel * denom));
    const item = coords[idx];

    dibujarGrafica(idx);
    tooltip.style.display = "block";
    tooltip.innerHTML = `<div><strong>${item.hora}</strong></div><div>T máx: <strong>${fmtNum(item.tmax, 1, " °C")}</strong></div>`;
    tooltip.style.left = `${Math.min(rect.width - 130, Math.max(10, mx + 12))}px`;
    tooltip.style.top = "12px";
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    dibujarGrafica(-1);
  });
}

function aplicarTelemetria(d) {
  if (!d) return;

  const tSeg = Number(d.t_s || 0);
  document.getElementById("modoBadge").textContent = `Modo: ${d.modo || "--"}`;
  document.getElementById("tiempoBadge").textContent = `t = ${Math.round(tSeg / 60)} min`;

  const est = d.estado || "NORMAL";
  const elEst = document.getElementById("estadoTexto");
  elEst.textContent = est.replace("_", " ");
  elEst.className = CLASES_ESTADO[est] || CLASES_ESTADO.NORMAL;

  document.getElementById("fanTexto").textContent = d.ventilador ? "ENCENDIDO" : "APAGADO";
  document.getElementById("tmaxTexto").textContent = fmtNum(d.Tmax, 1, " °C");

  const pred = Number(d.pred_min);
  let predTexto = "--";
  if (!Number.isNaN(pred)) {
    if (pred < 0) predTexto = "No llegaría";
    else if (pred === 0) predTexto = "En crítico";
    else predTexto = `${pred.toFixed(1)} min`;
  }
  document.getElementById("predTexto").textContent = predTexto;

  const temps = Array.isArray(d.T) ? d.T : [null, null];
  const hums = Array.isArray(d.H) ? d.H : [null, null];
  document.getElementById("t0Texto").textContent = fmtNum(temps[0], 1, " °C");
  document.getElementById("h0Texto").textContent = hums[0] === null || hums[0] === undefined ? "--" : `${hums[0]} % HR`;
  document.getElementById("t1Texto").textContent = fmtNum(temps[1], 1, " °C");
  document.getElementById("h1Texto").textContent = hums[1] === null || hums[1] === undefined ? "--" : `${hums[1]} % HR`;

  if (Array.isArray(d.eventos)) {
    const ul = document.getElementById("listaEventos");
    if (d.eventos.length === 0) {
      ul.innerHTML = '<li class="evento-vacio">Sin cambios de estado registrados</li>';
    } else {
      ul.innerHTML = d.eventos
        .map((ev) => `<li>${Math.round((ev.t || 0) / 60)} min: ${ev.de} → ${ev.a} (${fmtNum(ev.T, 1, " °C")})</li>`)
        .join("");
    }
  }

  if (d.Tmax !== null && d.Tmax !== undefined && !Number.isNaN(Number(d.Tmax))) {
    const valMax = Number(d.Tmax);
    const stamp = obtenerFechaHoraActual();
    const horaCorta = stamp.legible.split(" ")[1];
    historialTemp.push({ hora: horaCorta, tmax: valMax });
    if (historialTemp.length > MAX_PUNTOS) historialTemp.shift();

    registrosCSV.push({
      timestamp: stamp.timestamp,
      fecha_hora: stamp.legible,
      t_s: tSeg,
      T_C: valMax.toFixed(1),
      estado: est,
      ventilador: d.ventilador ? 1 : 0
    });
    if (registrosCSV.length > MAX_REGISTROS_STORAGE) registrosCSV.shift();

    guardarEnLocalStorage();
    dibujarGrafica(-1);
  }
}

function abrirModalExportar() {
  document.getElementById("modalExportar").classList.add("abierto");
}

function cerrarModalExportar() {
  document.getElementById("modalExportar").classList.remove("abierto");
}

function confirmarExportarCSV() {
  const columnas = Array.from(document.querySelectorAll(".col-csv:checked")).map((cb) => cb.value);
  if (columnas.length === 0) return;

  const rango = document.getElementById("selRangoCsv").value;
  const ahora = Date.now();
  let filtrados = registrosCSV;

  if (rango === "10" || rango === "20") {
    const minutos = Number(rango);
    const limiteMs = ahora - minutos * 60 * 1000;
    filtrados = registrosCSV.filter((r) => r.timestamp >= limiteMs);
  }

  const encabezado = columnas.join(",");
  const filas = filtrados.map((r) => columnas.map((col) => r[col]).join(","));
  const contenido = [encabezado, ...filas].join("\n");

  const stamp = obtenerFechaHoraActual();
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `datos_rack_${stamp.archivo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  cerrarModalExportar();
}

document.getElementById("modalExportar").addEventListener("click", (e) => {
  if (e.target.id === "modalExportar") cerrarModalExportar();
});

document.getElementById("modalQR").addEventListener("click", (e) => {
  if (e.target.id === "modalQR") cerrarModalQR();
});

const client = mqtt.connect(WSS_URL, {
  reconnectPeriod: 2500,
  connectTimeout: 8000
});

client.on("connect", () => {
  client.subscribe([TOPIC_DATOS, TOPIC_ESTADO]);
});

client.on("message", (topic, payload) => {
  const texto = payload.toString();
  if (topic === TOPIC_ESTADO) {
    if (texto === "online") {
      ultimoMensajeMs = Date.now();
      actualizarConexion(true);
    } else if (texto === "offline") {
      actualizarConexion(false);
    }
  } else if (topic === TOPIC_DATOS) {
    try {
      const data = JSON.parse(texto);
      ultimoMensajeMs = Date.now();
      actualizarConexion(true);
      aplicarTelemetria(data);
    } catch (e) {}
  }
});

function enviarConfig(reiniciar) {
  if (rolActual === "espectador") return;
  const payload = {
    modo: document.getElementById("selModo").value,
    P: parseFloat(document.getElementById("selCarga").value),
    Ta: parseFloat(document.getElementById("inpTamb").value),
    Ton: parseFloat(document.getElementById("inpTon").value),
    falla: document.getElementById("chkFalla").checked,
    reiniciar: Boolean(reiniciar)
  };
  if (reiniciar) {
    limpiarAlmacenamiento();
  }
  if (client.connected) {
    client.publish(TOPIC_CONFIG, JSON.stringify(payload));
  }
}

setInterval(() => {
  if (espOnline && Date.now() - ultimoMensajeMs > 5000) {
    actualizarConexion(false);
  }
}, 1000);

window.addEventListener("resize", () => dibujarGrafica(-1));
detectarRolInicial();
configurarTooltip();
cargarDesdeLocalStorage();
actualizarConexion(false);
dibujarGrafica(-1);
