/**
 * Subtítulos quemados en el video.
 *
 * Por qué esto importa para "viralizar": la gran mayoría del consumo de
 * video corto en redes se hace CON EL SONIDO APAGADO. Si la historia no
 * se entiende sin audio, se pierde la mayor parte del alcance orgánico.
 * Por eso el pipeline quema subtítulos grandes y legibles en cada escena,
 * tanto en el episodio completo como en el clip corto ("gancho") para
 * redes.
 *
 * Nota técnica: usamos el filtro `drawtext` de ffmpeg (con el texto en un
 * archivo aparte vía `textfile=`) en vez del filtro `subtitles`/libass.
 * Probamos `subtitles` primero, pero libass calcula el tamaño de fuente
 * relativo a una resolución de guion que en esta configuración no queda
 * bien determinada, así que el texto sale gigante e ilegible sin importar
 * qué `FontSize` le pidamos. `drawtext` trabaja directo en píxeles del
 * frame de salida, sin ese problema.
 */
const fs = require("fs");

const DEJAVU_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function wrapText(text, width = 34) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

function captionTextFor(scene) {
  const parts = [];
  if (scene.narracion) parts.push(scene.narracion);
  for (const d of scene.dialogos || []) {
    parts.push(`${d.personaje}: "${d.linea}"`);
  }
  return parts.join("\n");
}

// Para el clip corto de redes conviene un texto más corto y directo que
// una narración completa: priorizamos el diálogo (más "humano" y ganchero)
// y si no hay, usamos la narración.
function shortCaptionFor(scene) {
  if (scene.dialogos && scene.dialogos.length) {
    return scene.dialogos.map((d) => `${d.personaje}: "${d.linea}"`).join("  ");
  }
  return scene.narracion || "";
}

function buildCaptionFile(text, outPath, wrapWidth = 34) {
  fs.writeFileSync(outPath, wrapText(text, wrapWidth), "utf-8");
  return outPath;
}

// El path va dentro de un value de opción de un filtro de ffmpeg: hay que
// escapar los ':' (separador de opciones) y las '\' propias de rutas.
function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function drawtextFilter(textFilePath, { fontSize = 30, y = 20, fontColor = "white", borderColor = "black@0.85", borderW = 3, lineSpacing = 8, fontFile = DEJAVU_BOLD } = {}) {
  return (
    `drawtext=fontfile='${escapeFilterPath(fontFile)}':textfile='${escapeFilterPath(textFilePath)}':` +
    `fontcolor=${fontColor}:fontsize=${fontSize}:borderw=${borderW}:bordercolor=${borderColor}:` +
    `line_spacing=${lineSpacing}:x=(w-text_w)/2:y=${y}`
  );
}

module.exports = {
  wrapText,
  captionTextFor,
  shortCaptionFor,
  buildCaptionFile,
  drawtextFilter,
  DEJAVU_BOLD,
};
