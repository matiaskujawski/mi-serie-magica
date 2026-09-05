/**
 * Prueba de punta a punta del pipeline SIN necesitar API keys:
 * toma data/sample-episode.json (un guion de ejemplo, como si lo
 * hubiera generado Claude) y lo renderiza a un .mp4 real usando los
 * proveedores "placeholder" (imagen dibujada + voz offline con flite).
 *
 * Uso: npm run demo:render
 */
const path = require("path");
const fs = require("fs");
const { renderEpisode } = require("../server/lib/episodeRenderer");

async function main() {
  const episodePath = path.join(__dirname, "..", "data", "sample-episode.json");
  const episode = JSON.parse(fs.readFileSync(episodePath, "utf-8"));
  const outDir = path.join(__dirname, "..", "output", "demo");

  console.log("Renderizando episodio de ejemplo...\n");
  const { finalPath, hookPath, log } = await renderEpisode(episode, { outDir });
  log.forEach((l) => console.log(" -", l));

  console.log("\n✅ Episodio completo generado en:", finalPath);
  console.log("✅ Clip vertical (gancho) generado en:", hookPath);
}

main().catch((err) => {
  console.error("❌ Error en el render de prueba:", err);
  process.exit(1);
});
