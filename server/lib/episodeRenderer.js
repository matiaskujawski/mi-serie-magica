/**
 * Orquesta el render completo de un episodio a partir del JSON que
 * produce el "Story Architect": genera imagen + audio por escena,
 * arma el clip de cada escena, concatena todo en el .mp4 del episodio, y
 * arma además un clip vertical corto ("gancho") para redes reusando los
 * mismos assets (sin generar nada nuevo con IA) — pensado para que el
 * costo de producir el "anzuelo" viral sea básicamente cero.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const { generateSceneImage } = require("./imageProvider");
const { synthesizeScene } = require("./ttsProvider");
const { renderScene, renderHookScene, renderOutroCard, concatScenes } = require("./videoAssembler");

const CARD_SCRIPT = path.join(__dirname, "..", "..", "scripts", "generate_text_card.py");

function runPython(args) {
  return new Promise((resolve, reject) => {
    execFile("python3", args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function pickHookScene(episode) {
  if (episode.gancho && episode.gancho.escena_numero) {
    const found = episode.escenas.find((s) => s.numero === episode.gancho.escena_numero);
    if (found) return found;
  }
  // Fallback si el guion no trae "gancho": elegimos una escena intermedia
  // con diálogo, que suele ser más atractiva que la de apertura.
  const conDialogo = episode.escenas.filter((s) => (s.dialogos || []).length > 0);
  const pool = conDialogo.length ? conDialogo : episode.escenas;
  return pool[Math.min(pool.length - 1, Math.floor(pool.length / 2))];
}

async function renderEpisode(episode, { outDir, imageProvider = "placeholder", ttsProvider = "placeholder" }) {
  fs.mkdirSync(outDir, { recursive: true });

  const sceneFiles = [];
  const assetsByScene = {};
  const log = [];

  for (const scene of episode.escenas) {
    log.push(`Escena ${scene.numero}: generando imagen...`);
    const imagePath = await generateSceneImage(scene, outDir, imageProvider);

    log.push(`Escena ${scene.numero}: generando audio...`);
    const audioPath = await synthesizeScene(scene, outDir, ttsProvider);

    log.push(`Escena ${scene.numero}: renderizando clip...`);
    const sceneOut = path.join(outDir, `scene-${scene.numero}.mp4`);
    const { durationSeconds } = await renderScene(
      {
        imagePath,
        audioPath,
        cameraMovement: scene.movimiento_camara,
        minDurationSeconds: scene.duracion_seg,
        scene,
      },
      sceneOut
    );
    log.push(`Escena ${scene.numero}: lista (${durationSeconds.toFixed(1)}s).`);
    sceneFiles.push(sceneOut);
    assetsByScene[scene.numero] = { imagePath, audioPath };
  }

  const finalName = `t${episode.serie.temporada}e${episode.serie.capitulo}-${slugify(episode.serie.titulo_capitulo)}.mp4`;
  const finalPath = path.join(outDir, finalName);
  log.push("Concatenando escenas en el episodio final...");
  await concatScenes(sceneFiles, finalPath);
  log.push(`Listo: ${finalPath}`);

  // --- Clip vertical "gancho" para redes (TikTok/Reels/Shorts) ---
  log.push("Armando clip vertical para redes (gancho)...");
  const hookScene = pickHookScene(episode);
  const hookAssets = assetsByScene[hookScene.numero];
  const tituloArriba = `${episode.serie.titulo} · Cap. ${episode.serie.capitulo}`;

  const hookScenePath = path.join(outDir, `hook-scene.mp4`);
  await renderHookScene(
    {
      imagePath: hookAssets.imagePath,
      audioPath: hookAssets.audioPath,
      cameraMovement: hookScene.movimiento_camara,
      minDurationSeconds: hookScene.duracion_seg,
      scene: hookScene,
      tituloArriba,
    },
    hookScenePath
  );

  const outroCardImage = path.join(outDir, "hook-outro.png");
  await runPython([
    CARD_SCRIPT,
    JSON.stringify({
      out_path: outroCardImage,
      width: 1080,
      height: 1920,
      title: episode.gancho && episode.gancho.linea ? episode.gancho.linea : "¿Cómo sigue la historia?",
      subtitle: "Mirá el capítulo completo en tu-serie-magica.app",
      badge: `${episode.serie.titulo} · Temporada ${episode.serie.temporada}`,
    }),
  ]);
  const outroCardPath = path.join(outDir, "hook-outro.mp4");
  await renderOutroCard({ imagePath: outroCardImage, durationSeconds: 3 }, outroCardPath);

  const hookFinalName = `hook-t${episode.serie.temporada}e${episode.serie.capitulo}-${slugify(episode.serie.titulo_capitulo)}.mp4`;
  const hookFinalPath = path.join(outDir, hookFinalName);
  await concatScenes([hookScenePath, outroCardPath], hookFinalPath);
  log.push(`Clip vertical listo: ${hookFinalPath}`);

  return { finalPath, hookPath: hookFinalPath, log };
}

function slugify(text) {
  return (text || "episodio")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

module.exports = { renderEpisode };
