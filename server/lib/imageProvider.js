/**
 * Proveedor de imágenes — capa intercambiable.
 *
 * Modo "placeholder": dibuja una tarjeta con degradé + el texto de la
 * escena usando Python/Pillow (scripts/generate_placeholder_image.py).
 * Es gratis y offline, y sirve para validar el pipeline completo.
 *
 * En producción, reemplazar por una llamada real a un proveedor con
 * "referencia de personaje" para mantener consistencia visual entre
 * escenas y episodios, por ejemplo:
 *   - fal.ai (modelos Flux, con soporte de imagen de referencia)
 *   - getimg.ai "Elements" (subís 1-20 fotos del personaje una vez y
 *     lo invocás como @NombrePersonaje en cualquier prompt)
 *   - OpenAI Images con imagen de referencia
 * La idea es subir una vez las fotos/reference art de cada personaje
 * (sea inventado o basado en una foto real que mandó la familia) y
 * reusar esa referencia en cada escena, en vez de generar personajes
 * nuevos cada vez (eso rompe la consistencia Y sale más caro).
 * Ver docs/arquitectura-tecnica.md, sección "Generación de imágenes".
 */
const { execFile } = require("child_process");
const path = require("path");

const PLACEHOLDER_SCRIPT = path.join(__dirname, "..", "..", "scripts", "generate_placeholder_image.py");

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

async function generateSceneImage(scene, outDir, provider = "placeholder") {
  if (provider === "placeholder") {
    return generateScenePlaceholder(scene, outDir);
  }
  throw new Error(
    `Proveedor de imágenes "${provider}" no implementado todavía en este prototipo. ` +
      `Agregá tu integración en server/lib/imageProvider.js (ver comentarios arriba).`
  );
}

module.exports = { generateSceneImage };
