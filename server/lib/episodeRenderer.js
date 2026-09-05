/**
 * Orquesta el render completo de un episodio a partir del JSON que
 * produce el "Story Architect": genera imagen + audio por escena,
 * arma el clip de cada escena, concatena todo en el .mp4 del episodio, y
 * arma además un clip vertical corto ("gancho") para redes reusando los
 * mismos assets (sin generar nada nuevo con IA) — pensado para que el
 * costo de producir el "anzuelo" viral sea básicamente cero.
 *
 * Dos cosas pensadas para no desperdiciar plata de las APIs pagas:
 *
 * 1. REANUDABLE: cada escena se guarda en disco con un nombre fijo
 *    (scene-N.png / scene-N.mp3|wav / scene-N.mp4) dentro de `outDir`. Si
 *    una escena ya tiene su .mp4 listo de un intento anterior (por ej.
 *    porque el render se cortó en la escena 4 por falta de crédito), un
 *    reintento con el MISMO outDir la salta en vez de volver a pagarla.
 *    `server/index.js` aprovecha esto: "Reintentar" reusa el mismo outDir,
 *    en vez de arrancar todo de cero.
 * 2. PROGRESO: recibe un `onProgress(update)` opcional que se llama en
 *    cada paso completado, con `{ stepsDone, totalSteps, message,
 *    sceneIndex, totalScenes }` — así el frontend puede mostrar una barra
 *    de progreso real (no un cartel fijo de "un momento...").
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const { generateSceneImage, ensureCharacterReferences } = require("./imageProvider");
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

function sceneImagePath(outDir, scene) {
  return path.join(outDir, `scene-${scene.numero}.png`);
}

function sceneAudioPath(outDir, scene, ttsProvider) {
  const ext = ttsProvider === "openai" ? "mp3" : "wav";
  return path.join(outDir, `scene-${scene.numero}.${ext}`);
}

function sceneVideoPath(outDir, scene) {
  return path.join(outDir, `scene-${scene.numero}.mp4`);
}

async function renderEpisode(
  episode,
  {
    outDir,
    imageProvider = "placeholder",
    ttsProvider = "placeholder",
    personajes = [],
    vozNarracion,
    onProgress = () => {},
  }
) {
  fs.mkdirSync(outDir, { recursive: true });

  const sceneFiles = [];
  const assetsByScene = {};
  const log = [];
  const totalScenes = episode.escenas.length;
  // 1 (referencias de personajes) + 3 por escena (imagen, audio, clip) + 4
  // (concat final, escena gancho, tarjeta de cierre, concat del gancho).
  const totalSteps = 1 + totalScenes * 3 + 4;
  let stepsDone = 0;

  function tick(message, extra = {}) {
    stepsDone += 1;
    log.push(message);
    onProgress({ stepsDone, totalSteps, message, ...extra });
  }

  log.push("Preparando referencias visuales de los personajes...");
  const characterRefs = await ensureCharacterReferences(personajes, imageProvider);
  tick("Referencias de personajes listas.");

  for (let i = 0; i < episode.escenas.length; i++) {
    const scene = episode.escenas[i];
    const sceneProgress = { sceneIndex: i + 1, totalScenes };
    const videoOut = sceneVideoPath(outDir, scene);

    if (fs.existsSync(videoOut)) {
      // Ya está lista de un intento anterior: la reusamos sin gastar nada.
      stepsDone += 3; // salta imagen + audio + render de esta escena
      log.push(`Escena ${scene.numero}: ya estaba lista de un intento anterior, se reusa.`);
      onProgress({
        stepsDone,
        totalSteps,
        message: `Escena ${scene.numero}/${totalScenes}: reusando resultado anterior.`,
        ...sceneProgress,
      });
      sceneFiles.push(videoOut);
      assetsByScene[scene.numero] = { imagePath: sceneImagePath(outDir, scene), audioPath: sceneAudioPath(outDir, scene, ttsProvider) };
      continue;
    }

    const imgOut = sceneImagePath(outDir, scene);
    let imagePath;
    if (fs.existsSync(imgOut)) {
      imagePath = imgOut;
      tick(`Escena ${scene.numero}/${totalScenes}: imagen ya generada, se reusa.`, sceneProgress);
    } else {
      onProgress({ stepsDone, totalSteps, message: `Escena ${scene.numero}/${totalScenes}: generando imagen con IA...`, ...sceneProgress });
      imagePath = await generateSceneImage(scene, outDir, imageProvider, characterRefs);
      tick(`Escena ${scene.numero}/${totalScenes}: imagen lista.`, sceneProgress);
    }

    const audioOut = sceneAudioPath(outDir, scene, ttsProvider);
    let audioPath;
    if (fs.existsSync(audioOut)) {
      audioPath = audioOut;
      tick(`Escena ${scene.numero}/${totalScenes}: audio ya generado, se reusa.`, sceneProgress);
    } else {
      onProgress({ stepsDone, totalSteps, message: `Escena ${scene.numero}/${totalScenes}: generando la voz...`, ...sceneProgress });
      audioPath = await synthesizeScene(scene, outDir, ttsProvider, { personajes, vozNarracion });
      tick(`Escena ${scene.numero}/${totalScenes}: audio listo.`, sceneProgress);
    }

    onProgress({ stepsDone, totalSteps, message: `Escena ${scene.numero}/${totalScenes}: armando el clip...`, ...sceneProgress });
    const { durationSeconds } = await renderScene(
      {
        imagePath,
        audioPath,
        cameraMovement: scene.movimiento_camara,
        minDurationSeconds: scene.duracion_seg,
        scene,
      },
      videoOut
    );
    tick(`Escena ${scene.numero}/${totalScenes}: lista (${durationSeconds.toFixed(1)}s).`, sceneProgress);

    sceneFiles.push(videoOut);
    assetsByScene[scene.numero] = { imagePath, audioPath };
  }

  const finalName = `t${episode.serie.temporada}e${episode.serie.capitulo}-${slugify(episode.serie.titulo_capitulo)}.mp4`;
  const finalPath = path.join(outDir, finalName);
  onProgress({ stepsDone, totalSteps, message: "Concatenando escenas en el episodio final..." });
  await concatScenes(sceneFiles, finalPath);
  tick(`Episodio listo: ${path.basename(finalPath)}`);

  // --- Clip vertical "gancho" para redes (TikTok/Reels/Shorts) ---
  const hookScene = pickHookScene(episode);
  const hookAssets = assetsByScene[hookScene.numero];
  const tituloArriba = `${episode.serie.titulo} · Cap. ${episode.serie.capitulo}`;

  const hookScenePath = path.join(outDir, `hook-scene.mp4`);
  onProgress({ stepsDone, totalSteps, message: "Armando clip vertical para redes (gancho)..." });
  if (fs.existsSync(hookScenePath)) {
    tick("Clip vertical del gancho ya estaba listo, se reusa.");
  } else {
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
    tick("Clip vertical del gancho listo.");
  }

  const outroCardImage = path.join(outDir, "hook-outro.png");
  const outroCardPath = path.join(outDir, "hook-outro.mp4");
  onProgress({ stepsDone, totalSteps, message: "Armando la tarjeta de cierre..." });
  if (fs.existsSync(outroCardPath)) {
    tick("Tarjeta de cierre ya estaba lista, se reusa.");
  } else {
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
    await renderOutroCard({ imagePath: outroCardImage, durationSeconds: 3 }, outroCardPath);
    tick("Tarjeta de cierre lista.");
  }

  const hookFinalName = `hook-t${episode.serie.temporada}e${episode.serie.capitulo}-${slugify(episode.serie.titulo_capitulo)}.mp4`;
  const hookFinalPath = path.join(outDir, hookFinalName);
  onProgress({ stepsDone, totalSteps, message: "Uniendo el clip para redes..." });
  await concatScenes([hookScenePath, outroCardPath], hookFinalPath);
  tick(`Clip vertical listo: ${path.basename(hookFinalPath)}`);

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
