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
capítulo completo.

Ya está integrado el modo de **generación real** (arte de personajes con
fal.ai/Flux y voz en español con OpenAI `gpt-4o-mini-tts`) — ver "Cómo
activar la generación real" más abajo. Por defecto el proyecto sigue
corriendo en modo "placeholder" (gratis, offline) hasta que se configuren
esas claves, para poder probar el pipeline sin gastar nada.

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

El proyecto ya está desplegado en vivo en Render (Docker), así que también
se puede probar directamente en la URL pública sin instalar nada
localmente — ver "Cómo activar la generación real" más abajo para pasar de
placeholders a arte/voz reales ahí.

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

## Cómo activar la generación real (salir del modo "placeholder")

El código ya tiene los dos proveedores reales integrados
(`server/lib/imageProvider.js` y `server/lib/ttsProvider.js`). Para
activarlos alcanza con variables de entorno, sin tocar código:

1. **Imágenes reales, con el personaje consistente entre escenas**
   (fal.ai, modelos Flux): conseguir una clave en fal.ai/dashboard/keys y
   setear `FAL_KEY` e `IMAGE_PROVIDER=fal`. Por cada personaje, si la
   familia subió una foto se usa esa foto como referencia; si no, se genera
   una única imagen de referencia a partir de su descripción, y esa misma
   referencia se reusa (editada por escena) en todo el capítulo — el costo
   de "crear" al personaje se paga una sola vez, no por escena. También
   hace falta `PUBLIC_BASE_URL` (la URL pública del sitio, ej.
   `https://mi-serie-magica.onrender.com`) para que fal.ai pueda descargar
   las fotos que suben los usuarios.
2. **Voz real en español** (OpenAI `gpt-4o-mini-tts`, ~US$0.015/min):
   conseguir una clave en platform.openai.com/api-keys y setear
   `OPENAI_API_KEY` y `TTS_PROVIDER=openai`. La voz se elige con
   `TTS_VOICE` (por defecto `coral`, cálida).

Ver `.env.example` para la lista completa, y `render.yaml` para cómo
quedan seteadas estas variables en Render (las claves secretas se cargan a
mano en el dashboard de Render, nunca en el repo).

El ensamblado de video (`videoAssembler.js`) y el resto del pipeline no
necesitan ningún cambio: reciben una imagen y un audio por escena sin
importar de dónde salieron.

## Cómo funciona el progreso y los reintentos (para no desperdiciar plata)

Como cada escena le pega a APIs pagas (fal.ai + OpenAI), el render está
armado para que un problema a mitad de camino (sin crédito, un error de
red, etc.) no te obligue a pagar de nuevo lo que ya se generó bien:

- `POST /api/render` ya no espera a que termine todo — arranca el render
  en segundo plano y devuelve un `job_id` al toque.
- El frontend consulta `GET /api/render/:id/status` cada 1.5s y muestra
  una barra de progreso real (basada en pasos completados, no un
  spinner genérico) con el detalle de qué escena se está generando.
- Si un trabajo falla, aparece un botón **"Reintentar"** que llama a
  `POST /api/render/:id/retry`: como cada escena queda guardada en disco
  con un nombre fijo (`scene-N.png` / `.mp3` / `.mp4`), el reintento salta
  las escenas que ya están listas y solo repite la que falló en adelante.
- Las referencias visuales de personajes (para los que no tienen foto)
  también se cachean para siempre en `output/character-refs/` — un
  personaje ya "creado" no se vuelve a pagar en el próximo capítulo, y de
  paso mantiene la misma cara entre episodios.

## Cómo se sostiene esto en el plan gratuito de Render (sin pagar más)

El plan free de Render da muy poca CPU (0.15 núcleo, un techo duro) y 512MB
de RAM. En una prueba real se vio que el proceso puede reiniciarse solo
cerca del final de un render (el paso más pesado de todos: el clip
vertical para redes, que combina blur + superposición + zoom en una sola
pasada de ffmpeg). Sin tocar de plan, se hicieron dos cosas para que esto
no te haga perder ni plata ni el trabajo ya hecho:

1. **ffmpeg más liviano**: todos los encodes usan `-preset veryfast` y un
   solo hilo (en una CPU fraccionada, dejar que ffmpeg reparta el trabajo
   en varios hilos solo suma overhead, no velocidad real), y el clip
   vertical bajó de 1080x1920 a 720x1280 (menos de la mitad de píxeles a
   procesar). El video final pesa un poco más por el preset más rápido,
   pero baja bastante la chance de que el servidor se quede sin recursos.
2. **El trabajo sobrevive a un reinicio del servidor**: cada trabajo de
   render ahora también se guarda en un `job.json` dentro de su carpeta en
   `output/`, no solo en memoria. Si el proceso se reinicia a mitad de
   camino, al arrancar de nuevo relee esos archivos y recupera el trabajo
   (en vez de que `/api/render/:id/status` devuelva "no encontramos ese
   trabajo" para siempre). El botón "Reintentar" en ese caso retoma el
   render justo donde se cortó, sin volver a pagar las escenas que ya
   estaban listas — igual que un reintento por cualquier otro motivo.

Esto reduce bastante el riesgo y el impacto de un corte, pero el techo de
CPU/RAM del plan free sigue siendo un techo real: si en el futuro los
capítulos son más largos o más pesados, la opción más simple para más
margen sigue siendo pasar al plan "Starter" de Render (US$7/mes, 0.5 CPU/
512MB) — una decisión de costo, no algo que haga falta ahora mismo.

## Qué falta para que esto sea un producto (fuera del alcance de este prototipo)

- Autenticación de familias, cobro/suscripción, moderación de contenido
  subido (fotos de chicos/mascotas).
- El render ya no es una sola request bloqueante — ver "Cómo funciona el
  progreso y los reintentos" abajo. Sigue siendo un trabajo en memoria del
  proceso (no una cola persistente tipo Redis/BullMQ), así que un reinicio
  del servidor a mitad de un render pierde ese trabajo puntual (aunque las
  escenas ya generadas quedan en disco).
- Almacenamiento persistente de los videos generados (hoy quedan en disco
  del servidor; en el plan free de Render el disco es efímero y se pierde
  en cada redeploy — para producción conviene subir los .mp4 finales a un
  storage tipo S3/R2).
- Reproductor/biblioteca "para chicos" más pulido (hoy ya es un formulario
  pensado para la familia, no un panel interno, pero falta pulir la
  experiencia de MIRAR la serie, no solo crearla: autoplay del próximo
  capítulo, pantalla completa, etc.).
- Moderar automáticamente el guion básico que ingresan las familias antes
  de mandarlo a Claude (filtro de contenido inapropiado en el input).

Ese plan de negocio y de producto se puede armar en una siguiente sesión;
esta entrega se enfocó en la arquitectura técnica y el prototipo, tal como
se definió al arrancar.
