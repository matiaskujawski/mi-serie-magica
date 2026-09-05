/**
 * Presets de voz para el modo "openai" del TTS (gpt-4o-mini-tts).
 *
 * OpenAI no publica género/edad oficial para cada voz (son nombres
 * abstractos: alloy, nova, onyx, etc.) — lo que sí soporta muy bien es un
 * campo `instructions` en texto libre que le indica al modelo CÓMO actuar
 * la lectura. Así que en vez de prometerle a la familia "esta es la voz de
 * una mujer" como un hecho de OpenAI, armamos presets propios que combinan
 * una voz base con instrucciones de actuación pensadas para lograr ese
 * efecto (mujer/hombre, joven/adulta/mayor) — es nuestra curaduría, no una
 * garantía del proveedor.
 *
 * Se usan en dos lugares:
 *   - Una vez por episodio, para la narración (texto de `scene.narracion`).
 *   - Por personaje, para sus líneas de diálogo — así cada uno se escucha
 *     distinto sin tener que decir "Fulano dice:" en voz alta.
 */

const BASE_STYLE =
  "Hablá en español neutro, con ritmo pausado y claro, apto para chicos " +
  "pequeños.";

const PRESETS = {
  calido: {
    label: "Cálida (recomendada)",
    voice: "coral",
    instructions: `${BASE_STYLE} Usá una voz cálida de narrador/a de cuentos infantiles.`,
  },
  mujer_joven: {
    label: "Mujer joven y alegre",
    voice: "nova",
    instructions: `${BASE_STYLE} Sonás como una mujer joven, alegre y llena de energía.`,
  },
  mujer_adulta: {
    label: "Mujer adulta, suave",
    voice: "shimmer",
    instructions: `${BASE_STYLE} Sonás como una mujer adulta, suave y cariñosa.`,
  },
  mujer_mayor: {
    label: "Mujer mayor, dulce y sabia",
    voice: "sage",
    instructions: `${BASE_STYLE} Sonás como una abuela dulce y sabia, pausada al hablar.`,
  },
  hombre_joven: {
    label: "Hombre joven, con energía",
    voice: "echo",
    instructions: `${BASE_STYLE} Sonás como un chico joven, entusiasta y con mucha energía.`,
  },
  hombre_adulto: {
    label: "Hombre adulto, voz profunda",
    voice: "onyx",
    instructions: `${BASE_STYLE} Sonás como un hombre adulto, calmo y con voz profunda.`,
  },
  hombre_mayor: {
    label: "Hombre mayor, narrador clásico",
    voice: "fable",
    instructions: `${BASE_STYLE} Sonás como un abuelo sabio, con calidez de narrador clásico de cuentos.`,
  },
  heroica: {
    label: "Heroica y decidida",
    voice: "ash",
    instructions: `${BASE_STYLE} Sonás valiente y decidido/a, con energía de héroe de aventuras.`,
  },
  divertida: {
    label: "Divertida y juguetona",
    voice: "verse",
    instructions: `${BASE_STYLE} Sonás juguetón/a y divertido/a, con mucha expresividad.`,
  },
};

const DEFAULT_PRESET_KEY = "calido";

function resolvePreset(key) {
  return PRESETS[key] || PRESETS[DEFAULT_PRESET_KEY];
}

// Lista liviana para exponer por API al frontend (solo id + etiqueta).
function listPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label }));
}

module.exports = { PRESETS, DEFAULT_PRESET_KEY, resolvePreset, listPresets };
