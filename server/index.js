require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const { generateEpisodeScript } = require("./lib/claude");
const { renderEpisode } = require("./lib/episodeRenderer");

const app = express();
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
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

const EPISODES_DB = path.join(__dirname, "..", "output", "episodes.json");

function loadDb() {
  if (!fs.existsSync(EPISODES_DB)) return [];
  return JSON.parse(fs.readFileSync(EPISODES_DB, "utf-8"));
}

function saveDb(rows) {
  fs.mkdirSync(path.dirname(EPISODES_DB), { recursive: true });
  fs.writeFileSync(EPISODES_DB, JSON.stringify(rows, null, 2));
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

// 2) Renderiza un guion ya generado (imagen + audio + video por escena).
app.post("/api/render", async (req, res) => {
  try {
    const episodio = req.body.episodio;
    if (!episodio || !episodio.escenas) {
      return res.status(400).json({ ok: false, error: "Falta 'episodio' con su lista de 'escenas'." });
    }
    const id = uuidv4().slice(0, 8);
    const outDir = path.join(__dirname, "..", "output", id);
    const { finalPath, hookPath, log } = await renderEpisode(episodio, {
      outDir,
      imageProvider: process.env.IMAGE_PROVIDER || "placeholder",
      ttsProvider: process.env.TTS_PROVIDER || "placeholder",
    });

    const rows = loadDb();
    const publicPath = `/output/${id}/${path.basename(finalPath)}`;
    const hookPublicPath = `/output/${id}/${path.basename(hookPath)}`;
    rows.push({
      id,
      titulo: episodio.serie.titulo,
      titulo_capitulo: episodio.serie.titulo_capitulo,
      temporada: episodio.serie.temporada,
      capitulo: episodio.serie.capitulo,
      resumen: episodio.resumen_capitulo,
      video_url: publicPath,
      hook_url: hookPublicPath,
      creado: new Date().toISOString(),
    });
    saveDb(rows);

    res.json({ ok: true, video_url: publicPath, hook_url: hookPublicPath, log });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mini-series backend escuchando en http://localhost:${PORT}`);
  console.log(`Frontend de prueba en http://localhost:${PORT}/web/index.html`);
});
