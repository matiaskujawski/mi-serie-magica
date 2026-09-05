/**
 * Proveedor de voz (TTS) — capa intercambiable.
 *
 * Modo "placeholder": usa el filtro `flite` incluido en ffmpeg para generar
 * audio 100% offline y gratis, sin depender de ninguna cuenta paga. Sirve
 * para probar el pipeline completo. OJO: las voces de flite son en inglés
 * (no hay voz en español), así que el audio de demo va a "leer" el texto en
 * español con acento/fonética inglesa. Es esperado: es solo para validar
 * que el ensamblado de video con audio sincronizado funciona de punta a
 * punta.
 *
 * Modo "openai": usa `gpt-4o-mini-tts` (API REST de OpenAI) — voz real en
 * español, ~US$0.015/min. Requiere OPENAI_API_KEY. Voz configurable con
 * TTS_VOICE (por defecto "coral", cálida). Alternativas si se quiere más
 * expresividad y el costo no es problema: Google Cloud TTS Neural, Azure
 * TTS Neural (similar precio a OpenAI), o ElevenLabs (~$0.03-0.05/min).
 * Ver docs/arquitectura-tecnica.md, sección "Costos".
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

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

async function synthesizeSceneOpenAI(scene, outDir) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta OPENAI_API_KEY en el entorno para usar TTS_PROVIDER=openai.");
  }
  const text = buildNarrationText(scene);
  const voice = process.env.TTS_VOICE || "coral";
  const mp3Path = path.join(outDir, `scene-${scene.numero}.mp3`);

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text,
      voice,
      instructions:
        "Hablá en español neutro, con voz cálida de narrador/a de cuentos infantiles, " +
        "ritmo pausado y claro, apto para chicos pequeños.",
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI TTS respondió ${res.status}: ${errBody}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(mp3Path, buffer);
  return mp3Path;
}

async function synthesizeScene(scene, outDir, provider = "placeholder") {
  if (provider === "placeholder") {
    return synthesizeScenePlaceholder(scene, outDir);
  }
  if (provider === "openai") {
    return synthesizeSceneOpenAI(scene, outDir);
  }
  throw new Error(
    `Proveedor de TTS "${provider}" no implementado todavía en este prototipo. ` +
      `Agregá tu integración en server/lib/ttsProvider.js (ver comentarios arriba).`
  );
}

module.exports = { synthesizeScene, buildNarrationText };
