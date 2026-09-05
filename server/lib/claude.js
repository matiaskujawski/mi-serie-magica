/**
 * Cliente de Claude para el rol "Story Architect".
 *
 * Toma la entrada del padre/madre (personajes, guion básico, specs) y le
 * pide a Claude que devuelva el guion técnico del episodio en el formato
 * JSON definido en server/prompts/story-architect.system.md.
 *
 * Requiere ANTHROPIC_API_KEY en el entorno. Si no está configurada, las
 * rutas que la usan devuelven un error claro (el resto del pipeline —
 * imagen/audio/video — funciona igual usando data/sample-episode.json).
 */
const fs = require("fs");
const path = require("path");

const SYSTEM_PROMPT_PATH = path.join(__dirname, "..", "prompts", "story-architect.system.md");

function loadSystemPrompt() {
  return fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
}

function extractJson(text) {
  // Claude debería devolver JSON puro, pero por las dudas toleramos que
  // venga envuelto en ```json ... ``` o con texto alrededor.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("La respuesta de Claude no contenía un objeto JSON reconocible.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

// Llamamos directamente a la API HTTP de Claude (fetch nativo de Node 22),
// para no depender de ningún SDK externo en este prototipo.
async function generateEpisodeScript(entrada) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta ANTHROPIC_API_KEY en el entorno (.env). Copiá .env.example a .env y completá tu clave."
    );
  }

  const userMessage = `ENTRADA:\n${JSON.stringify(entrada, null, 2)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system: loadSystemPrompt(),
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API respondió ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude no devolvió contenido de texto.");

  return extractJson(textBlock.text);
}

module.exports = { generateEpisodeScript, loadSystemPrompt };
