require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const { generateEpisodeScript } = require("./lib/claude");
const { renderEpisode } = require("./lib/episodeRenderer");
const { listPresets } = require("./lib/voicePresets");

const app = express();
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const CHARACTER_REFS_DIR = path.join(__dirname, "..", "output", "character-refs");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB por foto, de sobra para una referencia
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error("Solo se aceptan fotos JPG, PNG o WEBP."));
    }
    cb(null, true);
  },
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/web", express.static(path.join(__dirname, "..", "web")));
app.get("/", (req, res) => res.redirect("/web/index.html"));
app.use("/output", express.static(path.join(__dirname, "..", "output")));
app.use("/uploads", express.static(UPLOADS_DIR));
// Referencias de personajes generadas y cacheadas por imageProvider.js —
// tienen que quedar accesibles públicamente porque fal.ai las vuelve a
// descargar en cada escena nueva (ver server/lib/imageProvider.js).
app.use("/character-refs", express.static(CHARACTER_REFS_DIR));

const EPISODES_DB = path.join(__dirname, "..", "output", "episodes.json");

function loadDb() {
  if (!fs.existsSync(EPISODES_DB)) return [];
  return JSON.parse(fs.readFileSync(EPISODES_DB, "utf-8"));
}

function saveDb(rows) {
  fs.mkdirSync(path.dirname(EPISODES_DB), { recursive: true });
  fs.writeFileSync(EPISODES_DB, JSON.stringify(rows, null, 2));
}

// --- Trabajos de render en curso ---
// El render de un capítulo puede tardar minutos y llamar a APIs pagas
// escena por escena, así que en vez de tener al navegador esperando una
// sola request gigante (bloqueante, y con riesgo de timeout), lo tratamos
// como un "trabajo": /api/render lo arranca y responde al toque con un
// job_id, y el frontend consulta /api/render/:id/status cada tanto para
// mostrar progreso real. Si un trabajo falla a mitad de camino (por
// ejemplo por quedarse sin crédito en una API), /api/render/:id/retry lo
// retoma reusando el mismo outDir — las escenas que ya se generaron y
// pagaron no se vuelven a pedir (ver server/lib/episodeRenderer.js).
//
// OJO: este mapa vive en memoria del proceso, pero cada job también se
// espeja a disco (ver `persistJob`/`loadPersistedJobs`) precisamente
// porque el plan free de Render puede reiniciar el proceso a mitad de un
// render (por ejemplo si se queda sin CPU/memoria en el paso final, que es
// el más pesado). Sin esto, un reinicio hacía que /api/render/:id/status
// devolviera 404 "no encontramos ese trabajo" aunque las escenas ya
// generadas y pagadas siguieran perfectas en el disco — el usuario
// terminaba sin poder ni ver que se podía reintentar. Con el archivo en
// disco, al arrancar el server recupera todos los trabajos conocidos y el
// botón "Reintentar" puede retomar el render justo donde se cortó (ver
// server/lib/episodeRenderer.js, que ya salta las escenas ya generadas).
const jobs = new Map();

function jobFilePath(outDir) {
  return path.join(outDir, "job.json");
}

function persistJob(job) {
  try {
    fs.mkdirSync(job.outDir, { recursive: true });
    fs.writeFileSync(jobFilePath(job.outDir), JSON.stringify(job, null, 2));
  } catch (err) {
    // Persistir el job es una red de seguridad, no algo que deba tumbar el
    // render si por lo que sea falla (ej. disco lleno).
    console.error(`No se pudo guardar el estado del trabajo ${job.id} en disco:`, err.message);
  }
}

// Al arrancar, relee todos los trabajos que hayan quedado guardados en
// output/*/job.json de una corrida anterior del proceso. Los que hayan
// quedado "running" es porque el proceso se cortó a mitad de camino (no
// porque terminaron mal de verdad), así que se marcan como error con un
// mensaje claro para la familia en vez de quedar fantasmas.
function loadPersistedJobs() {
  const outputRoot = path.join(__dirname, "..", "output");
  if (!fs.existsSync(outputRoot)) return;
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jobPath = jobFilePath(path.join(outputRoot, entry.name));
    if (!fs.existsSync(jobPath)) continue;
    try {
      const job = JSON.parse(fs.readFileSync(jobPath, "utf-8"));
      if (job.status === "running") {
        job.status = "error";
        job.error =
          "El servidor se reinició mientras se generaba este capítulo (puede pasar en el plan gratuito). " +
          "Lo que ya se había generado no se perdió: tocá 'Reintentar' para retomarlo desde ahí.";
      }
      jobs.set(job.id, job);
    } catch (err) {
      console.error(`No se pudo leer el trabajo guardado en ${jobPath}:`, err.message);
    }
  }
  if (jobs.size) {
    console.log(`Se recuperaron ${jobs.size} trabajo(s) guardados en disco de una corrida anterior.`);
  }
}

function buildJob(id, episodio, personajes, vozNarracion, outDir) {
  return {
    id,
    status: "running", // "running" | "done" | "error"
    creado: new Date().toISOString(),
    episodio,
    personajes,
    vozNarracion,
    outDir,
    imageProvider: process.env.IMAGE_PROVIDER || "placeholder",
    ttsProvider: process.env.TTS_PROVIDER || "placeholder",
    progress: { stepsDone: 0, totalSteps: 1, message: "Arrancando..." },
    log: [],
    result: null,
    error: null,
  };
}

async function runRenderJob(job) {
  job.status = "running";
  job.error = null;
  persistJob(job);
  try {
    const { finalPath, hookPath, log } = await renderEpisode(job.episodio, {
      outDir: job.outDir,
      imageProvider: job.imageProvider,
      ttsProvider: job.ttsProvider,
      personajes: job.personajes,
      vozNarracion: job.vozNarracion,
      onProgress: (update) => {
        job.progress = update;
        persistJob(job);
      },
    });
    job.log = log;

    const rows = loadDb();
    const publicPath = `/output/${job.id}/${path.basename(finalPath)}`;
    const hookPublicPath = `/output/${job.id}/${path.basename(hookPath)}`;
    rows.push({
      id: job.id,
      titulo: job.episodio.serie.titulo,
      titulo_capitulo: job.episodio.serie.titulo_capitulo,
      temporada: job.episodio.serie.temporada,
      capitulo: job.episodio.serie.capitulo,
      resumen: job.episodio.resumen_capitulo,
      video_url: publicPath,
      hook_url: hookPublicPath,
      creado: new Date().toISOString(),
    });
    saveDb(rows);

    job.result = { video_url: publicPath, hook_url: hookPublicPath };
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err.message;
  }
  persistJob(job);
}

// 0) Sube la foto de referencia de un personaje (opcional). Devuelve una
// URL que el frontend guarda en el personaje y que, cuando conectemos un
// proveedor de imágenes real con soporte de referencia, se le pasa para
// mantener a ese personaje consistente en todas las escenas.
app.post("/api/upload-foto", upload.single("foto"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No se recibió ninguna foto." });
  res.json({ ok: true, foto_url: `/uploads/${req.file.filename}` });
});

// 1) Genera el guion estructurado del episodio (llama a Claude).
app.post("/api/guion", async (req, res) => {
  try {
    const episodio = await generateEpisodeScript(req.body);
    res.json({ ok: true, episodio });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 2) Arranca el render de un guion ya generado (imagen + audio + video por
// escena). Responde enseguida con un job_id — no espera a que termine.
app.post("/api/render", (req, res) => {
  const episodio = req.body.episodio;
  const personajes = req.body.personajes || [];
  const vozNarracion = req.body.voz_narracion;
  if (!episodio || !episodio.escenas) {
    return res.status(400).json({ ok: false, error: "Falta 'episodio' con su lista de 'escenas'." });
  }
  const id = uuidv4().slice(0, 8);
  const outDir = path.join(__dirname, "..", "output", id);
  const job = buildJob(id, episodio, personajes, vozNarracion, outDir);
  jobs.set(id, job);
  persistJob(job);

  res.json({ ok: true, job_id: id });
  runRenderJob(job);
});

// 2.bis) Progreso de un trabajo de render en curso.
app.get("/api/render/:id/status", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({
      ok: false,
      error: "No encontramos ese trabajo (puede haberse reiniciado el servidor). Probá generar el capítulo de nuevo.",
    });
  }
  res.json({
    ok: true,
    status: job.status,
    progress: job.progress,
    log: job.log,
    result: job.result,
    error: job.error,
  });
});

// 2.ter) Reintenta un trabajo que falló, reusando lo que ya se generó (no
// vuelve a pagar las escenas que ya estaban listas).
app.post("/api/render/:id/retry", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({
      ok: false,
      error: "No encontramos ese trabajo para reintentar (puede haberse reiniciado el servidor). Probá generar el capítulo de nuevo.",
    });
  }
  if (job.status === "running") {
    return res.json({ ok: true, job_id: job.id }); // ya está corriendo, no lo disparamos dos veces
  }
  res.json({ ok: true, job_id: job.id });
  runRenderJob(job);
});

// 2.quater) Catálogo de voces disponibles (para los selectores del
// formulario: voz de cada personaje + voz de la locución/narración).
app.get("/api/voces", (req, res) => {
  res.json({ ok: true, voces: listPresets() });
});

// 3) Biblioteca de episodios ya generados (para la pantalla "mi serie").
app.get("/api/episodios", (req, res) => {
  const rows = loadDb();
  // Para poder sugerir automáticamente "próximo capítulo" en el frontend.
  const porSerie = {};
  for (const ep of rows) {
    const key = ep.titulo;
    porSerie[key] = Math.max(porSerie[key] || 0, ep.capitulo);
  }
  res.json({ ok: true, episodios: rows, ultimo_capitulo_por_serie: porSerie });
});

loadPersistedJobs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mini-series backend escuchando en http://localhost:${PORT}`);
  console.log(`Frontend de prueba en http://localhost:${PORT}/web/index.html`);
});
