const API = ""; // mismo origen (server sirve /web y /api)

const charsContainer = document.getElementById("chars");
const statusEl = document.getElementById("status");
const guionOutputEl = document.getElementById("guionOutput");
const detalleGuionEl = document.getElementById("detalleGuion");
const episodiosEl = document.getElementById("episodios");
const btnGenerar = document.getElementById("btnGenerar");
const btnReintentar = document.getElementById("btnReintentar");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const guionBasicoEl = document.getElementById("guionBasico");
const btnModoEscribo = document.getElementById("btnModoEscribo");
const btnModoSorpresa = document.getElementById("btnModoSorpresa");
const serieTituloEl = document.getElementById("serieTitulo");
const capituloEl = document.getElementById("capitulo");
const temporadaEl = document.getElementById("temporada");

let charSeq = 0;
let modoGuion = "escribo"; // "escribo" | "sorpresa"
let ultimoCapituloPorSerie = {};
let VOCES = []; // catálogo de voces, se completa al arrancar (ver initVoces)
let chipsVozNarracion = { value: "calido" };

// --- Plantillas rápidas de personajes (para no arrancar de la hoja en blanco) ---
const TEMPLATES = [
  { label: "🐶 Mascota real", tipo: "mascota_real", placeholder: "Ej: perro marrón mediano, orejas caídas, muy cariñoso" },
  { label: "👪 Familiar real", tipo: "familiar_real", placeholder: "Ej: su hermano mayor, le encanta el fútbol y hacer bromas" },
  { label: "🧚 Personaje mágico", tipo: "inventado", placeholder: "Ej: hada pequeña de luz dorada, alas transparentes, valiente" },
  { label: "🦸 Superhéroe", tipo: "inventado", placeholder: "Ej: superhéroe con capa azul, súper fuerza y muy buen corazón" },
  { label: "🐉 Criatura fantástica", tipo: "inventado", placeholder: "Ej: dragón bebé color verde, no puede volar todavía" },
  { label: "🤖 Robot amigo", tipo: "inventado", placeholder: "Ej: robot pequeño y curioso, habla con pitidos y luces" },
];

const templatesContainer = document.getElementById("templates");
TEMPLATES.forEach((t) => {
  const chip = document.createElement("div");
  chip.className = "chip template";
  chip.textContent = t.label;
  chip.addEventListener("click", () => addCharCard({ tipo: t.tipo, descripcionPlaceholder: t.placeholder }));
  templatesContainer.appendChild(chip);
});

// --- Colores disponibles para el lienzo de dibujo ---
const DRAW_COLORS = ["#1a1a1a", "#e63946", "#f4a261", "#f6c445", "#2a9d8f", "#264653", "#7b2cbf", "#ffffff"];

function vozOptionsHtml(selectedValue) {
  const lista = VOCES.length ? VOCES : [{ id: "calido", label: "Cálida (recomendada)" }];
  return lista
    .map((v) => `<option value="${v.id}" ${v.id === selectedValue ? "selected" : ""}>${v.label}</option>`)
    .join("");
}

function addCharCard({ nombre = "", tipo = "inventado", descripcion = "", descripcionPlaceholder = "Descripción física y de personalidad", voz = "calido" } = {}) {
  const id = ++charSeq;
  const card = document.createElement("div");
  card.className = "char-card";
  card.dataset.id = id;
  card.innerHTML = `
    <button type="button" class="remove-btn" title="Quitar personaje">✕</button>
    <div class="char-top">
      <label class="photo-upload" title="Subir foto de referencia (opcional)">
        <span class="photo-placeholder">📷</span>
        <img class="photo-preview" hidden />
        <input type="file" accept="image/png,image/jpeg,image/webp" class="c-foto" hidden />
      </label>
      <div class="char-fields">
        <input type="text" placeholder="Nombre del personaje" class="c-nombre" value="${nombre}" />
        <select class="c-tipo">
          <option value="inventado" ${tipo === "inventado" ? "selected" : ""}>Personaje inventado</option>
          <option value="mascota_real" ${tipo === "mascota_real" ? "selected" : ""}>Mascota real</option>
          <option value="familiar_real" ${tipo === "familiar_real" ? "selected" : ""}>Familiar real</option>
        </select>
        <select class="c-voz" title="Voz de este personaje en los diálogos">${vozOptionsHtml(voz)}</select>
      </div>
    </div>
    <div class="foto-toggle">
      <button type="button" class="foto-tab active" data-modo="foto">📷 Foto</button>
      <button type="button" class="foto-tab" data-modo="dibujo">✏️ Dibujar</button>
    </div>
    <div class="draw-panel" hidden>
      <div class="draw-toolbar">
        ${DRAW_COLORS.map((c, i) => `<button type="button" class="swatch${i === 0 ? " selected" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}
        <button type="button" class="draw-btn borrar">Borrar</button>
        <button type="button" class="draw-btn confirm usar">✔️ Usar este dibujo</button>
      </div>
      <canvas class="c-canvas" width="320" height="320"></canvas>
    </div>
    <textarea class="c-desc" placeholder="${descripcionPlaceholder}" style="margin-top:8px;">${descripcion}</textarea>
  `;

  card.querySelector(".remove-btn").addEventListener("click", () => card.remove());

  const fileInput = card.querySelector(".c-foto");
  const img = card.querySelector(".photo-preview");
  const placeholder = card.querySelector(".photo-placeholder");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result;
      img.hidden = false;
      placeholder.hidden = true;
    };
    reader.readAsDataURL(file);
    card._fotoFile = file;
    card._fotoFileName = null; // los File nativos ya traen su propio nombre
    card._fotoUrl = null; // se sube recién al generar
  });

  setupFotoODibujo(card, { img, placeholder });

  charsContainer.appendChild(card);
  card.querySelector(".c-nombre").focus();
}

// Toggle "Foto" / "Dibujar" + lienzo de dibujo libre. El resultado del
// dibujo se trata exactamente igual que una foto subida: se guarda en
// card._fotoFile (acá un Blob del canvas en vez de un File del input) y se
// sube recién al tocar "Crear mi capítulo" (ver subirFotosPendientes),
// reusando el mismo endpoint /api/upload-foto.
function setupFotoODibujo(card, { img, placeholder }) {
  const tabFoto = card.querySelector('.foto-tab[data-modo="foto"]');
  const tabDibujo = card.querySelector('.foto-tab[data-modo="dibujo"]');
  const panel = card.querySelector(".draw-panel");
  const canvas = card.querySelector(".c-canvas");
  const ctx = canvas.getContext("2d");
  let color = DRAW_COLORS[0];
  let dibujando = false;

  function fondoBlanco() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  fondoBlanco();

  function mostrarTab(modo) {
    tabFoto.classList.toggle("active", modo === "foto");
    tabDibujo.classList.toggle("active", modo === "dibujo");
    panel.hidden = modo !== "dibujo";
  }
  tabFoto.addEventListener("click", () => mostrarTab("foto"));
  tabDibujo.addEventListener("click", () => mostrarTab("dibujo"));

  card.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      color = sw.dataset.color;
      card.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
    });
  });

  function posDesdeEvento(evt) {
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width / rect.width;
    const escalaY = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * escalaX, y: (evt.clientY - rect.top) * escalaY };
  }

  canvas.addEventListener("pointerdown", (evt) => {
    dibujando = true;
    const { x, y } = posDesdeEvento(evt);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 8;
    ctx.strokeStyle = color;
  });
  canvas.addEventListener("pointermove", (evt) => {
    if (!dibujando) return;
    const { x, y } = posDesdeEvento(evt);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evtName) => {
    canvas.addEventListener(evtName, () => {
      dibujando = false;
    });
  });

  card.querySelector(".draw-btn.borrar").addEventListener("click", fondoBlanco);

  card.querySelector(".draw-btn.usar").addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      card._fotoFile = blob;
      card._fotoFileName = "dibujo.png";
      card._fotoUrl = null;
      img.src = canvas.toDataURL("image/png");
      img.hidden = false;
      placeholder.hidden = true;
      mostrarTab("foto");
    }, "image/png");
  });
}

document.getElementById("addChar").addEventListener("click", () => addCharCard());

// --- Modo de guion: "lo escribo yo" vs "sorprendeme" ---
btnModoEscribo.addEventListener("click", () => setModoGuion("escribo"));
btnModoSorpresa.addEventListener("click", () => setModoGuion("sorpresa"));

function setModoGuion(modo) {
  modoGuion = modo;
  btnModoEscribo.classList.toggle("active", modo === "escribo");
  btnModoSorpresa.classList.toggle("active", modo === "sorpresa");
  guionBasicoEl.hidden = modo === "sorpresa";
  if (modo === "sorpresa") {
    guionBasicoEl.dataset.savedValue = guionBasicoEl.value;
  } else if (guionBasicoEl.dataset.savedValue) {
    guionBasicoEl.value = guionBasicoEl.dataset.savedValue;
  }
}

// --- Chips de selección única (edad, duración, voz de narración) ---
function buildChipGroup(containerId, options, defaultValue) {
  const container = document.getElementById(containerId);
  let selected = defaultValue;
  options.forEach((opt) => {
    const chip = document.createElement("div");
    chip.className = "chip" + (opt.value === defaultValue ? " selected" : "");
    chip.textContent = opt.label;
    chip.addEventListener("click", () => {
      selected = opt.value;
      [...container.children].forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
    });
    container.appendChild(chip);
  });
  return { get value() { return selected; } };
}

const chipsEdad = buildChipGroup("chipsEdad", [
  { label: "3-5 años", value: "3-5 años" },
  { label: "6-8 años", value: "6-8 años" },
  { label: "9-12 años", value: "9-12 años" },
], "6-8 años");

const chipsDuracion = buildChipGroup("chipsDuracion", [
  { label: "Cortito (~1 min)", value: 60 },
  { label: "Medio (~2-3 min)", value: 150 },
  { label: "Largo (~4-5 min)", value: 270 },
], 150);

// --- Sugerir automáticamente el próximo capítulo si la serie ya existe ---
serieTituloEl.addEventListener("blur", () => {
  const ultimo = ultimoCapituloPorSerie[serieTituloEl.value.trim()];
  if (ultimo) capituloEl.value = ultimo + 1;
});

// --- Armado de la entrada para el backend ---
async function subirFotosPendientes() {
  const cards = [...charsContainer.querySelectorAll(".char-card")];
  for (const card of cards) {
    if (card._fotoFile && !card._fotoUrl) {
      const formData = new FormData();
      const nombreArchivo = card._fotoFile.name || card._fotoFileName || "foto.jpg";
      formData.append("foto", card._fotoFile, nombreArchivo);
      const res = await fetch(`${API}/api/upload-foto`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.ok) card._fotoUrl = data.foto_url;
    }
  }
}

function leerPersonajes() {
  return [...charsContainer.querySelectorAll(".char-card")]
    .map((card) => ({
      nombre: card.querySelector(".c-nombre").value.trim(),
      tipo: card.querySelector(".c-tipo").value,
      descripcion: card.querySelector(".c-desc").value.trim(),
      voz: card.querySelector(".c-voz").value,
      tiene_foto_referencia: !!card._fotoUrl,
      foto_referencia_url: card._fotoUrl || null,
    }))
    .filter((p) => p.nombre);
}

function leerEntrada() {
  return {
    personajes: leerPersonajes(),
    guion_basico: modoGuion === "sorpresa" ? "" : guionBasicoEl.value.trim(),
    edad_objetivo: chipsEdad.value,
    duracion_objetivo_seg: chipsDuracion.value,
    temporada: Number(temporadaEl.value) || 1,
    capitulo: Number(capituloEl.value) || 1,
  };
}

// --- Progreso del render: polling a /api/render/:id/status ---
let currentJobId = null;
let pollTimer = null;
let fallosSeguidos = 0;
// Tolerancia a fallos transitorios del ping (un 502 pasajero, o el servidor
// gratuito de Render reiniciándose solo): con un poll cada 1.5s, esto le da
// hasta ~45s para volver antes de darlo por perdido. Un solo fallo suelto
// NO debe mostrarle un error al usuario ni tirar el trabajo por la borda.
const MAX_FALLOS_SEGUIDOS = 30;

function mostrarProgreso(pct) {
  progressWrap.hidden = false;
  progressFill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
}

function ocultarProgreso() {
  progressWrap.hidden = true;
  progressFill.style.width = "0%";
}

function detenerPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function terminarConError(mensaje) {
  detenerPolling();
  fallosSeguidos = 0;
  statusEl.textContent = "Ups, algo falló: " + mensaje;
  btnReintentar.hidden = false;
  btnGenerar.disabled = false;
}

async function consultarProgreso(jobId) {
  let data;
  try {
    const res = await fetch(`${API}/api/render/${jobId}/status`);
    data = await res.json();
  } catch (err) {
    // Fallo de red/parseo puntual (ej: un 502 pasajero, o el servidor
    // reiniciándose): reintentamos en el próximo tick en vez de tirar todo
    // por la borda — el trabajo puede seguir corriendo bien del otro lado.
    fallosSeguidos += 1;
    if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
      return terminarConError("perdimos la conexión con el servidor por mucho tiempo (" + err.message + ")");
    }
    statusEl.textContent = "Reconectando con el servidor...";
    return;
  }

  if (!data.ok) {
    // Acá sí es un error real que el servidor nos devolvió explícitamente
    // (ej: "no encontramos ese trabajo"), no un problema de conexión.
    return terminarConError(data.error);
  }
  fallosSeguidos = 0;

  const { stepsDone = 0, totalSteps = 1, message } = data.progress || {};
  const pct = Math.round((stepsDone / totalSteps) * 100);

  if (data.status === "running") {
    mostrarProgreso(pct);
    statusEl.textContent = `${message || "Generando tu capítulo..."} (${pct}%)`;
  } else if (data.status === "done") {
    detenerPolling();
    ocultarProgreso();
    btnReintentar.hidden = true;
    btnGenerar.disabled = false;
    statusEl.textContent = "¡Listo! Tu capítulo se agregó a Mi Serie, abajo. 🎉";
    cargarEpisodios();
  } else if (data.status === "error") {
    terminarConError(data.error);
  }
}

function iniciarPolling(jobId) {
  currentJobId = jobId;
  fallosSeguidos = 0;
  btnReintentar.hidden = true;
  mostrarProgreso(2);
  consultarProgreso(jobId);
  pollTimer = setInterval(() => consultarProgreso(jobId), 1500);
}

btnReintentar.addEventListener("click", async () => {
  if (!currentJobId) return;
  btnReintentar.hidden = true;
  btnGenerar.disabled = true;
  statusEl.textContent = "Reintentando — retomamos desde donde se cortó, sin repetir (ni volver a pagar) lo que ya estaba listo...";
  try {
    const res = await fetch(`${API}/api/render/${currentJobId}/retry`, { method: "POST" });
    const data = await res.json();
    if (!data.ok) return terminarConError(data.error);
    iniciarPolling(data.job_id);
  } catch (err) {
    terminarConError(err.message);
  }
});

// --- Flujo principal: subir fotos -> guion -> render ---
btnGenerar.addEventListener("click", async () => {
  const personajes = leerPersonajes();
  if (!personajes.length) {
    statusEl.textContent = "Agregá al menos un personaje con nombre para arrancar.";
    return;
  }
  serieTituloEl.value = serieTituloEl.value.trim() || "Mi Serie Mágica";

  btnGenerar.disabled = true;
  btnReintentar.hidden = true;
  try {
    statusEl.textContent = "Subiendo fotos y dibujos de referencia...";
    await subirFotosPendientes();

    statusEl.textContent = "Escribiendo el guion del capítulo con IA...";
    const entrada = leerEntrada();
    entrada.serie_titulo = serieTituloEl.value.trim();
    const resGuion = await fetch(`${API}/api/guion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entrada),
    });
    const dataGuion = await resGuion.json();
    if (!dataGuion.ok) throw new Error(dataGuion.error);

    const episodio = dataGuion.episodio;
    guionOutputEl.textContent = JSON.stringify(episodio, null, 2);
    detalleGuionEl.hidden = false;

    statusEl.textContent = "Arrancando la generación de imágenes y voces...";
    const personajesActualizados = leerPersonajes(); // por si subieron fotos entre medio
    const resRender = await fetch(`${API}/api/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodio, personajes: personajesActualizados, voz_narracion: chipsVozNarracion.value }),
    });
    const dataRender = await resRender.json();
    if (!dataRender.ok) throw new Error(dataRender.error);

    // A partir de acá el render sigue en el servidor; consultamos el
    // progreso real en vez de dejar al usuario esperando sin feedback.
    iniciarPolling(dataRender.job_id);
  } catch (err) {
    statusEl.textContent = "Ups, algo falló: " + err.message;
    btnGenerar.disabled = false;
  }
});

async function cargarEpisodios() {
  const res = await fetch(`${API}/api/episodios`);
  const data = await res.json();
  ultimoCapituloPorSerie = data.ultimo_capitulo_por_serie || {};
  episodiosEl.innerHTML = "";
  if (!data.episodios || !data.episodios.length) {
    episodiosEl.innerHTML = '<div class="empty">Todavía no generaste ningún capítulo. ¡Armá el primero a la izquierda!</div>';
    return;
  }
  for (const ep of data.episodios.slice().reverse()) {
    const card = document.createElement("div");
    card.className = "episodio-card";
    card.innerHTML = `
      <span class="badge">T${ep.temporada}E${ep.capitulo}</span>
      <strong>${ep.titulo_capitulo}</strong>
      <video controls src="${ep.video_url}"></video>
      <small>${ep.resumen || ""}</small>
      <div class="download-row">
        <a href="${ep.video_url}" download>⬇ Episodio</a>
        ${ep.hook_url ? `<a href="${ep.hook_url}" download class="secondary">⬇ Clip redes</a>` : ""}
      </div>
    `;
    episodiosEl.appendChild(card);
  }
}

// --- Arranque: primero traemos el catálogo de voces (para los selectores
// de cada personaje y el chip de narración), recién ahí armamos los
// personajes de ejemplo y el resto de la página. ---
async function initVoces() {
  try {
    const res = await fetch(`${API}/api/voces`);
    const data = await res.json();
    if (data.ok && data.voces && data.voces.length) VOCES = data.voces;
  } catch {
    // Si falla, vozOptionsHtml ya tiene un fallback razonable ("calido").
  }
  chipsVozNarracion = buildChipGroup(
    "chipsVozNarracion",
    (VOCES.length ? VOCES : [{ id: "calido", label: "Cálida (recomendada)" }]).map((v) => ({ label: v.label, value: v.id })),
    "calido"
  );
}

async function init() {
  await initVoces();

  // Dos personajes de ejemplo para arrancar
  addCharCard({ nombre: "Toby", tipo: "mascota_real", descripcion: "Perro marrón mediano, orejas caídas, collar rojo. Cariñoso y curioso (basado en foto real de la familia).", voz: "hombre_joven" });
  addCharCard({ nombre: "Estrellita", tipo: "inventado", descripcion: "Hada pequeña de luz dorada, alas transparentes. Valiente y buena onda.", voz: "mujer_joven" });

  cargarEpisodios();
}

init();
