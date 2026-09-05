const API = ""; // mismo origen (server sirve /web y /api)

const charsContainer = document.getElementById("chars");
const statusEl = document.getElementById("status");
const guionOutputEl = document.getElementById("guionOutput");
const detalleGuionEl = document.getElementById("detalleGuion");
const episodiosEl = document.getElementById("episodios");
const btnGenerar = document.getElementById("btnGenerar");
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

// --- Flujo principal: subir fotos -> guion -> render ---
btnGenerar.addEventListener("click", async () => {
  const personajes = leerPersonajes();
  if (!personajes.length) {
    statusEl.textContent = "Agregá al menos un personaje con nombre para arrancar.";
    return;
  }
  serieTituloEl.value = serieTituloEl.value.trim() || "Mi Serie Mágica";

  btnGenerar.disabled = true;
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

    statusEl.textContent = "Generando imágenes y voces de cada escena...";
    const resRender = await fetch(`${API}/api/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodio, personajes }),
    });
    const dataRender = await resRender.json();
    if (!dataRender.ok) throw new Error(dataRender.error);

    statusEl.textContent = "¡Listo! Tu capítulo se agregó a Mi Serie, abajo. 🎉";
    cargarEpisodios();
  } catch (err) {
    statusEl.textContent = "Ups, algo falló: " + err.message;
  } finally {
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
