/**
 * Ensamblador de video "bajo costo": en vez de generar video cuadro a
 * cuadro con IA (carísimo y lento — hoy cuesta órdenes de magnitud más
 * por segundo que una imagen fija), armamos el capítulo a partir de:
 *
 *   1 imagen fija por escena + 1 audio narrado por escena
 *        -> efecto de cámara estilo "Ken Burns" (zoom/paneo) con ffmpeg
 *        -> se concatenan todas las escenas en un único .mp4
 *
 * Esta técnica es la misma que usan muchísimos canales infantiles y
 * explicativos de bajo presupuesto: se ve "animado" y profesional para
 * el público objetivo, y el costo es el de generar UNA imagen por escena
 * en vez de decenas de cuadros por segundo.
 *
 * v2 (más adelante): agregar animación liviana sobre el personaje
 * (parpadeo, boca sincronizada con el audio) usando Rive/Lottie o
 * un modelo de "image-to-video" corto solo en las escenas clave.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { captionTextFor, shortCaptionFor, buildCaptionFile, drawtextFilter } = require("./captions");

const FPS = 25;
const WIDTH = 1280;
const HEIGHT = 720;
// Antes 1080x1920: en el plan free de Render (0.15 CPU / 512MB) el clip
// vertical con blur+overlay+zoompan encadenados era el paso más pesado de
// todo el render y el más probable causante de que el proceso se quedara
// sin recursos cerca del final. Bajar la resolución del gancho reduce a
// menos de la mitad los píxeles a procesar en ese paso, sin verse mal en
// redes (sigue siendo HD).
const HOOK_WIDTH = 720;
const HOOK_HEIGHT = 1280;

// Ajustes pensados para correr en hardware muy limitado (CPU fraccionada
// tipo Render free): "veryfast" y un solo hilo evitan que ffmpeg gaste más
// CPU/RAM en overhead de paralelismo que no existe de verdad con menos de
// 1 núcleo disponible, y bajan bastante el tiempo/pico de recursos de cada
// encode a costa de un archivo levemente más pesado (aceptable para este
// prototipo). "-loglevel warning" evita acumular en memoria el progreso
// verboso de ffmpeg en cada llamada.
const ENCODE_ARGS = ["-preset", "veryfast", "-threads", "1"];
const QUIET_ARGS = ["-hide_banner", "-loglevel", "warning"];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(" ")}\n${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

async function probeDurationSeconds(filePath) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const seconds = parseFloat(out.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

// Nota: dentro de las expresiones x/y de zoompan NO se puede referenciar
// la variable 'd' (duración en frames) directamente, así que la recibimos
// ya calculada desde JS y la insertamos como número literal.
function zoompanExprFor(cameraMovement, frames) {
  const lastFrame = Math.max(1, frames - 1);
  switch (cameraMovement) {
    case "zoom_in":
      return {
        z: "min(zoom+0.0025,1.2)",
        x: "iw/2-(iw/zoom/2)",
        y: "ih/2-(ih/zoom/2)",
      };
    case "zoom_out":
      return {
        z: "if(eq(on,0),1.2,max(zoom-0.0025,1.0))",
        x: "iw/2-(iw/zoom/2)",
        y: "ih/2-(ih/zoom/2)",
      };
    case "pan_right":
      return {
        z: "1.15",
        x: `(iw-iw/zoom)*(on/${lastFrame})`,
        y: "ih/2-(ih/zoom/2)",
      };
    case "pan_left":
      return {
        z: "1.15",
        x: `(iw-iw/zoom)*(1-(on/${lastFrame}))`,
        y: "ih/2-(ih/zoom/2)",
      };
    case "static":
    default:
      return {
        z: "1.05",
        x: "iw/2-(iw/zoom/2)",
        y: "ih/2-(ih/zoom/2)",
      };
  }
}

async function renderScene({ imagePath, audioPath, cameraMovement, minDurationSeconds, scene, captions = true }, outPath) {
  const audioDuration = await probeDurationSeconds(audioPath);
  const durationSeconds = Math.max(minDurationSeconds || 0, audioDuration + 0.4, 2);
  const frames = Math.max(2, Math.round(durationSeconds * FPS));

  const { z, x, y } = zoompanExprFor(cameraMovement, frames);
  let filter =
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},` +
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;

  if (captions && scene) {
    const captionPath = outPath.replace(/\.mp4$/, ".caption.txt");
    buildCaptionFile(captionTextFor(scene), captionPath, 44);
    filter += `,${drawtextFilter(captionPath, { fontSize: 26, y: "h-text_h-30" })}`;
  }

  await run("ffmpeg", [
    ...QUIET_ARGS,
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-filter:v", filter,
    "-map", "0:v",
    "-map", "1:a",
    "-c:v", "libx264",
    ...ENCODE_ARGS,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-t", String(durationSeconds),
    outPath,
  ]);

  return { outPath, durationSeconds };
}

/**
 * Clip vertical (9:16) pensado para redes (TikTok/Reels/Shorts): reusa la
 * MISMA imagen y el MISMO audio ya generados para la escena "gancho" del
 * episodio — no dispara ningún costo extra de generación — y arma un
 * formato pensado para viralizar:
 *   - fondo desenfocado que llena todo el cuadro (evita franjas negras)
 *   - imagen principal centrada y legible
 *   - título de la serie/episodio arriba
 *   - subtítulos grandes abajo (la mayoría del consumo social es sin audio)
 */
async function renderHookScene({ imagePath, audioPath, cameraMovement, minDurationSeconds, scene, tituloArriba }, outPath) {
  const audioDuration = await probeDurationSeconds(audioPath);
  const durationSeconds = Math.max(minDurationSeconds || 0, audioDuration + 0.4, 2);
  const frames = Math.max(2, Math.round(durationSeconds * FPS));
  const cam = zoompanExprFor(cameraMovement || "zoom_in", frames);

  const captionPath = outPath.replace(/\.mp4$/, ".caption.txt");
  buildCaptionFile(shortCaptionFor(scene), captionPath, 26);
  const titlePath = outPath.replace(/\.mp4$/, ".title.txt");
  buildCaptionFile(tituloArriba, titlePath, 32);

  // Zona segura vertical típica de redes: dejamos margen arriba (ícono de
  // perfil/seguir) y abajo (like/comentar/compartir de TikTok e IG).
  const titleDraw = drawtextFilter(titlePath, { fontSize: 30, y: 70 });
  const captionDraw = drawtextFilter(captionPath, { fontSize: 34, y: Math.round(HOOK_HEIGHT * 0.7) });

  const filterComplex =
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${HOOK_WIDTH}:${HOOK_HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${HOOK_WIDTH}:${HOOK_HEIGHT},boxblur=16:2[bgblur];` +
    `[fg]scale=${HOOK_WIDTH}:${HOOK_HEIGHT}:force_original_aspect_ratio=decrease[fgscaled];` +
    `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[composite];` +
    `[composite]zoompan=z='${cam.z}':x='${cam.x}':y='${cam.y}':d=${frames}:s=${HOOK_WIDTH}x${HOOK_HEIGHT}:fps=${FPS}[zoomed];` +
    `[zoomed]${titleDraw}[titled];` +
    `[titled]${captionDraw}[out]`;

  await run("ffmpeg", [
    ...QUIET_ARGS,
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-map", "1:a",
    "-c:v", "libx264",
    ...ENCODE_ARGS,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-t", String(durationSeconds),
    outPath,
  ]);

  return { outPath, durationSeconds };
}

async function renderOutroCard({ imagePath, durationSeconds = 3 }, outPath) {
  const frames = Math.max(2, Math.round(durationSeconds * FPS));
  await run("ffmpeg", [
    ...QUIET_ARGS,
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=mono:sample_rate=16000",
    "-t", String(durationSeconds),
    "-vf", `scale=${HOOK_WIDTH}:${HOOK_HEIGHT},fps=${FPS}`,
    "-c:v", "libx264",
    ...ENCODE_ARGS,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outPath,
  ]);
  return { outPath, durationSeconds };
}

async function concatScenes(sceneFiles, outPath) {
  const listPath = outPath.replace(/\.mp4$/, ".concat.txt");
  const listContent = sceneFiles.map((f) => `file '${path.resolve(f)}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");

  // Acá NO se re-codifica (-c copy): es solo pegar los .mp4 de cada escena
  // uno después del otro, así que este paso ya era liviano de por sí.
  await run("ffmpeg", [
    ...QUIET_ARGS,
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    outPath,
  ]);

  return outPath;
}

module.exports = { renderScene, renderHookScene, renderOutroCard, concatScenes, probeDurationSeconds };
