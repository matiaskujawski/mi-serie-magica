/**
 * Proveedor de voz (TTS) — capa intercambiable.
 *
 * Modo "placeholder": usa el filtro `flite` incluido en ffmpeg para generar
 * audio 100% offline y gratis, sin depender de ninguna cuenta paga. Sirve
 * para probar el pipeline completo. OJO: las voces de flite son en inglés
 * (no hay voz en español), así que el audio de demo va a "leer" el texto en
 * español con acento/fonética inglesa. Es esperado: es solo para validar
 * que el ensamblado de video con audio sincronizado funciona de punta a
 * punta. Al ser una sola voz offline, no tiene sentido distinguir voces por
 * personaje acá — se lee todo el texto de la escena de un tirón.
 *
 * Modo "openai": usa `gpt-4o-mini-tts` (API REST de OpenAI) — voz real en
 * español, ~US$0.015/min. Requiere OPENAI_API_KEY. A diferencia del modo
 * placeholder, cada línea se sintetiza por separado con SU PROPIA voz:
 *   - La narración (`scene.narracion`) usa la voz elegida para "la
 *     locución" en el formulario (parámetro `vozNarracion`).
 *   - Cada línea de diálogo usa la voz que la familia le asignó a ESE
 *     personaje (`personaje.voz`), en vez de la vieja narración leyendo
 *     "Fulano dice: ...", que era un parche para poder distinguir quién
 *     hablaba con una sola voz.
 *   Los pedazos se generan como archivos separados y se pegan con ffmpeg
 *   (concat demuxer, sin recodificar) en un único audio por escena — el
 *   resto del pipeline (ffprobe para la duración, ensamblado de video) no
 *   se entera de que por dentro son varios pedazos.
 *   Ver server/lib/voicePresets.js para el catálogo de voces disponibles.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolvePreset } = require("./voicePresets");

function buildNarrationText(scene) {
  const parts = [scene.narracion || ""];
  for (const d of scene.dialogos || []) {
    parts.push(`${d.personaje} dice: ${d.linea}`);
  }
  return parts.filter(Boolean).join(" ... ");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

async function synthesizeScenePlaceholder(scene, outDir) {
  const text = buildNarrationText(scene);
  const textPath = path.join(outDir, `scene-${scene.numero}.txt`);
  const wavPath = path.join(outDir, `scene-${scene.numero}.wav`);
  fs.writeFileSync(textPath, text, "utf-8");

  await runFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `flite=textfile=${textPath}:voice=slt`,
    wavPath,
  ]);

  return wavPath;
}

async function callOpenAiTts(text, preset) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta OPENAI_API_KEY en el entorno para usar TTS_PROVIDER=openai.");
  }
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text,
      voice: preset.voice,
      instructions: preset.instructions,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI TTS respondió ${res.status}: ${errBody}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Concatena varios mp3 (mismo codec, generados todos acá mismo) en uno solo,
// sin recodificar — igual que concatScenes en videoAssembler.js pero para
// audio suelto.
async function concatAudioFiles(files, outPath) {
  if (files.length === 1) {
    fs.copyFileSync(files[0], outPath);
    return outPath;
  }
  const listPath = outPath.replace(/\.mp3$/, ".concat.txt");
  const listContent = files.map((f) => `file '${path.resolve(f)}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");
  await runFfmpeg(["-y", "-hide_banner", "-loglevel", "warning", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
  return outPath;
}

// Arma la lista ordenada de "quién dice qué": primero la narración (con la
// voz de locución elegida), después cada línea de diálogo (con la voz de
// ESE personaje). Si un personaje no tiene voz asignada (o no está en la
// lista de `personajes`), usa la voz por defecto.
function buildVoiceSegments(scene, { personajes = [], vozNarracion } = {}) {
  const vozPorPersonaje = {};
  for (const p of personajes) {
    if (p.nombre) vozPorPersonaje[p.nombre] = resolvePreset(p.voz);
  }
  const narratorPreset = resolvePreset(vozNarracion);

  const segments = [];
  if (scene.narracion) {
    segments.push({ text: scene.narracion, preset: narratorPreset });
  }
  for (const d of scene.dialogos || []) {
    if (!d.linea) continue;
    const preset = vozPorPersonaje[d.personaje] || narratorPreset;
    segments.push({ text: d.linea, preset });
  }
  if (!segments.length) {
    // Escena rarísima sin narración ni diálogos: mejor generar algo mínimo
    // que romper el render.
    segments.push({ text: ".", preset: narratorPreset });
  }
  return segments;
}

async function synthesizeSceneOpenAI(scene, outDir, opts = {}) {
  const segments = buildVoiceSegments(scene, opts);
  const mp3Path = path.join(outDir, `scene-${scene.numero}.mp3`);
  const segmentPaths = [];

  for (let i = 0; i < segments.length; i++) {
    const segPath = path.join(outDir, `scene-${scene.numero}-seg-${i}.mp3`);
    // Igual que con las escenas ya generadas: si este pedacito puntual ya
    // se había generado en un intento anterior que se cortó más adelante,
    // no lo volvemos a pagar.
    if (!fs.existsSync(segPath)) {
      const buffer = await callOpenAiTts(segments[i].text, segments[i].preset);
      fs.writeFileSync(segPath, buffer);
    }
    segmentPaths.push(segPath);
  }

  await concatAudioFiles(segmentPaths, mp3Path);

  // Los pedacitos ya están unidos en el archivo final; los borramos para no
  // dejar basura en el disco (efímero de por sí en Render, pero prolijo).
  for (const p of segmentPaths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // no pasa nada si ya no está
    }
  }
  const listPath = mp3Path.replace(/\.mp3$/, ".concat.txt");
  try {
    fs.unlinkSync(listPath);
  } catch {
    // solo existe si hubo más de un segmento
  }

  return mp3Path;
}

async function synthesizeScene(scene, outDir, provider = "placeholder", opts = {}) {
  if (provider === "placeholder") {
    return synthesizeScenePlaceholder(scene, outDir);
  }
  if (provider === "openai") {
    return synthesizeSceneOpenAI(scene, outDir, opts);
  }
  throw new Error(
    `Proveedor de TTS "${provider}" no implementado todavía en este prototipo. ` +
      `Agregá tu integración en server/lib/ttsProvider.js (ver comentarios arriba).`
  );
}

module.exports = { synthesizeScene, buildNarrationText };
