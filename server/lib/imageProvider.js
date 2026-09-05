/**
 * Proveedor de imágenes — capa intercambiable.
 *
 * Modo "placeholder": dibuja una tarjeta con degradé + el texto de la
 * escena usando Python/Pillow (scripts/generate_placeholder_image.py).
 * Es gratis y offline, y sirve para validar el pipeline completo.
 *
 * Modo "fal": usa fal.ai (modelos Flux) con referencia de personaje, para
 * mantener consistencia visual entre escenas y episodios:
 *   1. Una sola vez POR PERSONAJE EN TODA LA VIDA del proyecto (no por
 *      episodio) — ver `ensureCharacterReferences`: si la familia subió
 *      una foto, esa foto ES la referencia; si no, se genera UNA imagen de
 *      referencia a partir de su descripción (fal-ai/flux/schnell, texto
 *      -> imagen), se descarga a `output/character-refs/` y se cachea en
 *      `output/character-refs/cache.json` (clave = nombre + hash de la
 *      descripción). De ahí en más, todos los episodios de ese personaje
 *      reusan la MISMA referencia: no se vuelve a pagar, y de paso se
 *      soluciona el problema de que el personaje "cambie de cara" entre
 *      capítulos.
 *   2. Por cada escena (`generateSceneImage`), se usa fal-ai/flux-pro/kontext
 *      (imagen -> imagen) para "editar" la referencia del personaje
 *      principal de la escena hacia el lugar/situación que describe
 *      `descripcion_visual`, manteniendo su aspecto. Si la escena tiene
 *      más personajes, se los menciona en el prompt de texto (Kontext solo
 *      acepta una imagen de referencia por llamada).
 * Requiere FAL_KEY. Tanto las fotos que suben las familias como las
 * referencias generadas y cacheadas tienen que ser URLs públicas (por eso
 * PUBLIC_BASE_URL: fal.ai necesita poder descargarlas, no le sirve una
 * ruta local).
 * Ver docs/arquitectura-tecnica.md, sección "Generación de imágenes".
 */
const { execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PLACEHOLDER_SCRIPT = path.join(__dirname, "..", "..", "scripts", "generate_placeholder_image.py");
const CHARACTER_REFS_DIR = path.join(__dirname, "..", "..", "output", "character-refs");
const CHARACTER_REFS_CACHE = path.join(CHARACTER_REFS_DIR, "cache.json");

function slugify(text) {
  return (text || "personaje")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Clave estable por personaje: nombre + hash corto de su descripción, para
// que si alguien cambia la descripción se genere una referencia nueva (en
// vez de quedar pegado a un aspecto que ya no corresponde).
function characterCacheKey(p) {
  const hash = crypto.createHash("sha1").update(p.descripcion || "").digest("hex").slice(0, 10);
  return `${slugify(p.nombre)}-${hash}`;
}

function loadCharacterRefCache() {
  try {
    return JSON.parse(fs.readFileSync(CHARACTER_REFS_CACHE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCharacterRefCache(cache) {
  fs.mkdirSync(CHARACTER_REFS_DIR, { recursive: true });
  fs.writeFileSync(CHARACTER_REFS_CACHE, JSON.stringify(cache, null, 2));
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    execFile("python3", args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

async function generateScenePlaceholder(scene, outDir) {
  const outPath = path.join(outDir, `scene-${scene.numero}.png`);
  const payload = JSON.stringify({
    out_path: outPath,
    numero: scene.numero,
    lugar: scene.lugar,
    descripcion_visual: scene.descripcion_visual,
    personajes_en_escena: scene.personajes_en_escena || [],
  });
  await runPython([PLACEHOLDER_SCRIPT, payload]);
  return outPath;
}

function absoluteUrl(maybeRelativeUrl) {
  if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    throw new Error(
      `La foto de referencia "${maybeRelativeUrl}" es una ruta relativa y falta PUBLIC_BASE_URL ` +
        `en el entorno para convertirla en una URL pública que fal.ai pueda descargar.`
    );
  }
  return base.replace(/\/$/, "") + maybeRelativeUrl;
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen generada (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

async function falRequest(model, body) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("Falta FAL_KEY en el entorno para usar IMAGE_PROVIDER=fal.");
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`fal.ai (${model}) respondió ${res.status}: ${errBody}`);
  }
  return res.json();
}

// Se llama antes de generar las escenas. Devuelve { nombrePersonaje: urlDeReferencia }.
// Para personajes sin foto propia, primero busca en el caché en disco
// (output/character-refs/cache.json) antes de gastar una llamada a fal.ai —
// así un personaje que ya apareció en un capítulo anterior no se vuelve a
// pagar ni cambia de aspecto.
async function ensureCharacterReferences(personajes, provider) {
  const refs = {};
  if (provider !== "fal" || !personajes) return refs;

  const cache = loadCharacterRefCache();
  let cacheDirty = false;

  for (const p of personajes) {
    if (p.foto_referencia_url) {
      refs[p.nombre] = absoluteUrl(p.foto_referencia_url);
      continue;
    }

    const key = characterCacheKey(p);
    if (cache[key]) {
      refs[p.nombre] = absoluteUrl(cache[key]);
      continue;
    }

    // Sin foto y sin caché: generamos UNA imagen de referencia a partir de
    // la descripción, la guardamos en disco, y la cacheamos para siempre
    // (o hasta que cambie la descripción del personaje).
    const prompt =
      `Retrato de personaje de cuento infantil ilustrado, fondo neutro, cuerpo entero: ` +
      `${p.nombre} — ${p.descripcion || "sin descripción"}. Estilo cálido, colores vivos, apto para chicos.`;
    const data = await falRequest("fal-ai/flux/schnell", {
      prompt,
      image_size: "square_hd",
      num_images: 1,
    });
    const url = data && data.images && data.images[0] && data.images[0].url;
    if (!url) throw new Error(`fal.ai no devolvió una imagen de referencia para "${p.nombre}".`);

    fs.mkdirSync(CHARACTER_REFS_DIR, { recursive: true });
    const localPath = path.join(CHARACTER_REFS_DIR, `${key}.png`);
    await downloadToFile(url, localPath);
    const publicPath = `/character-refs/${key}.png`;
    cache[key] = publicPath;
    cacheDirty = true;
    refs[p.nombre] = absoluteUrl(publicPath);
  }

  if (cacheDirty) saveCharacterRefCache(cache);
  return refs;
}

async function generateSceneImageFal(scene, outDir, characterRefs) {
  const nombresEnEscena = scene.personajes_en_escena || [];
  const principal = nombresEnEscena.find((n) => characterRefs[n]);
  const outPath = path.join(outDir, `scene-${scene.numero}.png`);

  if (!principal) {
    // Ningún personaje de la escena tiene referencia todavía (raro, pero
    // por las dudas): generamos directo desde texto.
    const data = await falRequest("fal-ai/flux/schnell", {
      prompt: scene.descripcion_visual,
      image_size: "landscape_16_9",
      num_images: 1,
    });
    const url = data.images && data.images[0] && data.images[0].url;
    if (!url) throw new Error(`fal.ai no devolvió imagen para la escena ${scene.numero}.`);
    return downloadToFile(url, outPath);
  }

  const otros = nombresEnEscena.filter((n) => n !== principal);
  const prompt =
    `${scene.descripcion_visual}` +
    (otros.length ? ` También aparecen en la escena: ${otros.join(", ")}.` : "") +
    ` Mantené el aspecto físico del personaje de la imagen de referencia sin cambiarlo.`;

  const data = await falRequest("fal-ai/flux-pro/kontext", {
    prompt,
    image_url: characterRefs[principal],
  });
  const url = data.images && data.images[0] && data.images[0].url;
  if (!url) throw new Error(`fal.ai no devolvió imagen para la escena ${scene.numero}.`);
  return downloadToFile(url, outPath);
}

async function generateSceneImage(scene, outDir, provider = "placeholder", characterRefs = {}) {
  if (provider === "placeholder") {
    return generateScenePlaceholder(scene, outDir);
  }
  if (provider === "fal") {
    return generateSceneImageFal(scene, outDir, characterRefs);
  }
  throw new Error(
    `Proveedor de imágenes "${provider}" no implementado todavía en este prototipo. ` +
      `Agregá tu integración en server/lib/imageProvider.js (ver comentarios arriba).`
  );
}

module.exports = { generateSceneImage, ensureCharacterReferences };
