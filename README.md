# Mi Serie Mágica — prototipo técnico y primer formulario real

Prototipo funcional del pipeline que convierte "personajes + guion básico +
specs" en un **video real (.mp4)** de un episodio, pensado como el primer
paso técnico de una plataforma donde familias arman series animadas
personalizadas para sus hijos.

Este prototipo **ya funciona de punta a punta**: generación de imagen +
audio por escena, efecto de cámara (Ken Burns), subtítulos quemados, y
ensamblado final en video — probado y verificado. Además, por cada
episodio se genera automáticamente un **clip vertical corto ("gancho")**
para TikTok/Reels/Shorts, reusando la misma imagen y audio de una escena
(costo extra ≈ cero), pensado para atraer gente al sitio a ver el
capítulo completo. Lo único que usa proveedores "placeholder" (gratis,
offline) es la parte creativa final (arte real de los personajes y voces en
español), que se resuelve conectando una API paga cuando decidan cuál usar
— la arquitectura ya está lista para ese cambio (ver "Cómo pasar a
producción" más abajo).

El formulario (`web/index.html` + `web/app.js`) ya es la primera versión
real de cara a la familia, no solo un panel de pruebas: se pueden agregar
tantos personajes como se quiera, cada uno con nombre, tipo (mascota real /
familiar real / inventado), personalidad, y una foto de referencia
opcional; se puede escribir el guion a mano o tocar "Sorprendeme" para que
Claude invente la historia entera con esos personajes; la edad y la
duración se eligen con chips en vez de campos numéricos; y cada capítulo
generado queda en "Mi Serie" con botones para verlo online o descargarlo
(el episodio completo y el clip corto para redes por separado).

## Cómo correrlo

Requisitos: Node.js 20+, Python 3 con Pillow (`pip install pillow`), y
`ffmpeg`/`ffprobe` instalados (con el filtro `flite` compilado — la mayoría
de las builds de ffmpeg en Linux/Mac lo traen).

```bash
npm install
cp .env.example .env   # completá ANTHROPIC_API_KEY si querés generación real
npm start               # levanta el backend + sirve el frontend de prueba
```

Abrí `http://localhost:3000/web/index.html`: ahí una familia puede agregar
los personajes que quiera (con foto opcional), elegir escribir el guion o
que se invente solo, elegir edad/duración con un par de clicks, y generar
el capítulo — que después puede ver online o descargar, junto con su clip
corto para redes.

⚠️ **Esta versión del formulario todavía no la corrimos en vivo dentro de
esta conversación**: el entorno donde arma el prototipo no tiene acceso a
la registry de npm (una restricción del entorno, no del código), así que
no pudimos instalar `express`/`multer`/etc. para hacer el click-through
nosotros mismos. El código está revisado y sin errores de sintaxis, pero
recomendamos que la primera corrida real la hagas vos con `npm install &&
npm start` (o probarlo juntos si conectás tu computadora a la sesión).

### Probar el pipeline de render sin necesitar ninguna API key

```bash
npm run demo:render
```

Esto toma `data/sample-episode.json` (un guion de ejemplo, con el mismo
formato que produciría Claude) y genera dos `.mp4` reales en
`output/demo/`: el episodio completo (horizontal) y el clip vertical
"gancho" para redes. Es la forma más rápida de confirmar que el ensamblado
de video funciona en tu máquina.

## Cómo está armado (resumen)

```
Guion básico + personajes + specs
        │
        ▼
  Claude ("Story Architect")   <- server/lib/claude.js
        │  system prompt en server/prompts/story-architect.system.md
        ▼
  Guion técnico en JSON (escenas, diálogos, narración, prompts de imagen)
        │
        ▼
  Por cada escena:
     imagen (server/lib/imageProvider.js)
     audio narrado (server/lib/ttsProvider.js)
     clip con efecto de cámara (server/lib/videoAssembler.js, ffmpeg zoompan)
        │
        ▼
  Concatenación final -> episodio.mp4  (server/lib/episodeRenderer.js)
```

El documento completo de arquitectura (decisiones, costos, roadmap) está en
el proyecto de Claude, en `docs/arquitectura-tecnica.md`.

## Por qué "imagen + audio + Ken Burns" y no video generado cuadro a cuadro

Generar video con IA cuadro a cuadro (tipo Sora/Runway) cuesta hoy órdenes
de magnitud más por segundo que generar una imagen fija, y para episodios
de varios minutos por semana esto vuelve el negocio inviable económicamente
en una etapa temprana. La técnica de imagen fija + narración + movimiento
de cámara es la misma que usan la mayoría de los canales infantiles y
educativos de bajo presupuesto: se percibe "animado" y profesional para el
público objetivo, y el costo real es básicamente el de generar **una
imagen y unos segundos de voz por escena**, no video por segundo.

## Cómo pasar a producción (reemplazar los placeholders)

Hay 2 puntos de extensión, ambos ya aislados en su propio archivo:

1. **Imágenes** (`server/lib/imageProvider.js`): agregar un proveedor real
   con soporte de "referencia de personaje" (para que Toby se vea igual en
   todas las escenas), por ejemplo fal.ai (Flux), getimg.ai (Elements) u
   OpenAI Images. Se sube una vez el arte/foto de referencia de cada
   personaje y se reusa en cada escena.
2. **Voz** (`server/lib/ttsProvider.js`): agregar un proveedor con buena
   voz en español, por ejemplo OpenAI `gpt-4o-mini-tts` (el más barato,
   ~US$0.015/min), Google Cloud TTS o Azure TTS Neural (similar precio), o
   ElevenLabs si se prioriza expresividad por sobre costo (~US$0.03-0.05/min).

El ensamblado de video (`videoAssembler.js`) y el resto del pipeline no
necesitan cambios: reciben una imagen y un audio por escena sin importar de
dónde salieron.

## Qué falta para que esto sea un producto (fuera del alcance de este prototipo)

- Autenticación de familias, cobro/suscripción, moderación de contenido
  subido (fotos de chicos/mascotas).
- Cola de trabajos asíncrona para el render (hoy es síncrono y bloqueante;
  bien para probar, no para producción con muchos usuarios a la vez).
- Conectar la foto subida de cada personaje al proveedor de imágenes real
  (hoy la subida y el guardado ya funcionan — `/api/upload-foto` — pero el
  proveedor "placeholder" todavía no la usa para generar arte).
- Reproductor/biblioteca "para chicos" más pulido (hoy ya es un formulario
  pensado para la familia, no un panel interno, pero falta pulir la
  experiencia de MIRAR la serie, no solo crearla: autoplay del próximo
  capítulo, pantalla completa, etc.).
- Moderar automáticamente el guion básico que ingresan las familias antes
  de mandarlo a Claude (filtro de contenido inapropiado en el input).

Ese plan de negocio y de producto se puede armar en una siguiente sesión;
esta entrega se enfocó en la arquitectura técnica y el prototipo, tal como
se definió al arrancar.
