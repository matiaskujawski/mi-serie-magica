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

function addCharCard({ nombre = "", tipo = "inventado", descripcion = "", descripcionPlaceholder = "Descripción física y de personalidad" } = {}) {
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
      </div>
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
    card._fotoUrl = null; // se sube recién al generar
  });

  charsContainer.appendChild(card);
  card.querySelector(".c-nombre").focus();
}

document.getElementById("addChar").addEventListener("click", () => addCharCard());

// Dos personajes de ejemplo para arrancar
addCharCard({ nombre: "Toby", tipo: "mascota_real", descripcion: "Perro marrón mediano, orejas caídas, collar rojo. Cariñoso y curioso (basado en foto real de la familia)." });
addCharCard({ nombre: "Estrellita", tipo: "inventado", descripcion: "Hada pequeña de luz dorada, alas transparentes. Valiente y buena onda." });

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

// --- Chips de edad y duración (selección única) ---
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
      formData.append("foto", card._fotoFile);
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
    statusEl.textContent = "Subiendo fotos de referencia...";
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
    const resRender = await fetch(`${API}/api/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodio, personajes }),
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

cargarEpisodios();
