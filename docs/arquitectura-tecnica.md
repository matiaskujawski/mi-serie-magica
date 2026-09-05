# Arquitectura técnica — Mi Serie Mágica (mini-series personalizadas para chicos)

**Estado:** prototipo funcional probado de punta a punta (imagen + audio +
video ensamblado). Este documento cubre solo la arquitectura técnica y el
prototipo, según lo que definimos para esta etapa — el plan de negocio
completo (pricing, adquisición de familias, etc.) queda para una próxima
sesión.

## 1. La idea en una frase

Una familia describe personajes (reales o inventados) y una idea básica de
historia; el sistema arma un episodio completo — guion, "arte" por escena,
narración y video — de una serie personalizada que el chico puede mirar
como si fuera Netflix, y que sigue creciendo temporada a temporada.

## 2. Por qué "imagen + voz + movimiento de cámara" y no video generado cuadro a cuadro

Esta fue la decisión de arquitectura más importante, porque define si el
proyecto es viable económicamente desde el día uno:

- Generar video con IA cuadro a cuadro (tipo los modelos de "texto a
  video" más conocidos) cuesta hoy órdenes de magnitud más por segundo que
  generar una sola imagen fija. Para un producto donde cada familia puede
  querer varios capítulos por temporada, ese costo no cierra en una etapa
  temprana.
- La alternativa —y la que usa la enorme mayoría de canales infantiles y
  educativos de bajo presupuesto en YouTube— es: **una imagen fija por
  escena + narración en audio + movimiento de cámara (efecto "Ken
  Burns": zoom y paneo sobre la imagen)**. El resultado se percibe como un
  cuento animado, mantiene al chico enganchado, y el costo real por
  episodio es el de generar unas pocas imágenes y algunos minutos de voz,
  no video por segundo.
- Esto es exactamente lo que el prototipo implementa y lo que ya
  verificamos que funciona (ver sección 6).

Una mejora natural para más adelante (Fase 2) es agregarle animación
liviana a los personajes dentro de cada imagen (parpadeo, boca que se
mueve al hablar) sin llegar a generar video completo — más "vida" sin
disparar el costo.

## 3. Pipeline completo

```
Familia completa: personajes + guion básico + specs (temporada, capítulos, edad)
        │
        ▼
[1] STORY ARCHITECT (Claude) — expande la idea a un guion técnico
        │   ver docs/prompt-story-architect.md
        ▼
   JSON del episodio: escenas con lugar, descripción visual, diálogos,
   narración, movimiento de cámara, duración estimada
        │
        ▼
[2] Por cada escena, EN PARALELO:
      (a) generación de imagen (personaje consistente vía referencia)
      (b) síntesis de voz de la narración/diálogos
        │
        ▼
[3] ENSAMBLADO DE VIDEO (ffmpeg): imagen + audio + Ken Burns -> clip de escena
        │
        ▼
[4] Concatenación de todos los clips -> episodio.mp4
        │
        ▼
[4.bis] A partir de la escena "gancho" (ya generada, sin costo extra):
        clip vertical corto con subtítulos para TikTok/Reels/Shorts,
        con CTA final al sitio (ver sección 6.bis)
        │
        ▼
[5] Biblioteca "Mi Serie": el chico elige temporada/capítulo y mira, con
    auto-reproducción del siguiente capítulo para fomentar el "engancharse"
```

### Contrato de datos entre Claude y el pipeline

Claude (el "Story Architect") no devuelve prosa: devuelve un JSON
estructurado, escena por escena, que el resto del sistema consume de forma
automática. Esto es clave para poder automatizar todo el pipeline sin
intervención manual. El esquema completo y las reglas (seguridad infantil,
consistencia de personajes, control de costos) están en
`docs/prompt-story-architect.md` — es el system prompt listo para usar con
la API de Claude.

## 4. Componentes y dónde conectar proveedores reales

| Componente | En el prototipo | En producción |
|---|---|---|
| Guion del episodio | Claude (`claude-sonnet-4-5` vía API HTTP directa) | Igual — ya es "real", solo necesita tu `ANTHROPIC_API_KEY` |
| Imagen por escena | Generador local con Python/Pillow (tarjeta con texto, gratis) | Proveedor con "referencia de personaje": fal.ai (Flux), getimg.ai (Elements), OpenAI Images |
| Voz narrada | `flite` (motor offline de ffmpeg, sin costo, solo voces en inglés) | OpenAI `gpt-4o-mini-tts`, Google Cloud TTS Neural, Azure TTS Neural o ElevenLabs |
| Ensamblado de video | ffmpeg (zoompan + concat) — **ya es el definitivo**, no cambia | Igual |
| Frontend | Panel de prueba simple (HTML/JS) | UI final "para chicos": biblioteca tipo streaming, reproductor con autoplay |

La razón de mantener imagen y voz como "placeholders" en esta etapa es que
son la parte que hay que elegir según presupuesto y gusto (ver costos
abajo) — el resto de la arquitectura no cambia una vez que se elige el
proveedor.

## 5. Consistencia de personajes entre escenas y episodios

Para que Toby (o cualquier personaje) se vea igual en todas las escenas —
y no un perro distinto cada vez — hay dos mecanismos combinados:

1. **A nivel de guion:** el system prompt de Claude obliga a mantener una
   "biblia de personaje" (mismo color, tamaño, ropa, accesorios) y a
   repetir esa descripción con un tag `@NombrePersonaje` en cada escena
   donde aparece.
2. **A nivel de imagen:** el proveedor de imágenes elegido debe soportar
   "referencia de personaje" — subís 1-20 fotos o arte de referencia una
   sola vez (por ejemplo, la foto real de la mascota, o el arte generado
   la primera vez que aparece un personaje inventado) y el proveedor lo
   reutiliza en cada escena nueva invocándolo por nombre. Varios
   proveedores actuales (2026) ofrecen esto de forma nativa (ej. "Elements"
   de getimg.ai, o modelos con condicionamiento por imagen de referencia
   como Flux).

Esto también cubre el caso de personajes basados en **fotos reales**
(mascota o familiar): se sube la foto una vez como referencia y se
reutiliza, en vez de tener que describirla en texto.

## 6. Prueba de concepto ya verificada

Se corrió el pipeline completo con un guion de ejemplo (`data/sample-episode.json`,
5 escenas) usando los proveedores placeholder: generó 5 imágenes, 5 audios,
5 clips con Ken Burns, y los concatenó en un `.mp4` final de ~47 segundos,
video H.264 + audio AAC, 1280x720 — reproducible en cualquier navegador o
reproductor de video. Confirma que la arquitectura de ensamblado funciona
de punta a punta antes de invertir en proveedores pagos de imagen/voz.

## 6.bis Estrategia de viralización (bajo costo, reusando lo ya generado)

Definimos esto en la segunda vuelta del prototipo, pensando específicamente
en "que se pueda viralizar más rápido":

- **Subtítulos quemados en todo video que se genera.** La mayoría del
  consumo de video corto en redes es sin audio; si la historia no se
  entiende en silencio, se pierde casi todo el alcance orgánico. El
  pipeline quema subtítulos (vía `drawtext` de ffmpeg, en pixeles exactos —
  probamos primero con `libass`/`subtitles` pero escalaba mal el tamaño de
  fuente y lo reemplazamos) tanto en el episodio como en el clip corto.
- **Cada episodio genera además un clip vertical corto ("gancho")** listo
  para TikTok/Reels/Shorts, **reusando la misma imagen y el mismo audio**
  de una escena ya generada — cero costo extra de IA. Este clip: recorta
  en 9:16 con fondo desenfocado (sin franjas negras), muestra el título de
  la serie arriba, el momento más intrigante de la escena con subtítulo
  grande, y termina con una tarjeta de cierre (CTA) invitando a ver el
  capítulo completo en el sitio.
- **El "Story Architect" (Claude) ya elige el momento gancho por nosotros:**
  el guion técnico incluye un campo `gancho` con la escena más atractiva y
  una frase de intriga que no revela el final — pensado específicamente
  para maximizar clics desde redes hacia el sitio, sin necesitar edición
  manual.
- Costo marginal de esta estrategia: prácticamente cero (es la misma
  imagen/audio, solo un render de ffmpeg extra), así que no atenta contra
  el objetivo de mantener el costo de producción bajísimo.

## 7. Estimación de costos por episodio (según proveedores 2026)

Para un episodio de referencia de ~3-5 minutos con 8-12 escenas:

- **Guion (Claude):** un puñado de miles de tokens de entrada/salida →
  centavos de dólar por episodio.
- **Voz narrada:** con `gpt-4o-mini-tts` (el más económico, ~US$0.015 por
  minuto de audio) o Google/Azure TTS Neural (similar, ~US$0.016/min): un
  episodio de 4 minutos narrados ronda **US$0.06-0.10**. Con ElevenLabs
  (voces más expresivas, ~US$0.03-0.05/min) sería **US$0.12-0.25**.
- **Imágenes:** 8-12 imágenes por episodio a un costo típico de
  generación con referencia de personaje de entre US$0.01 y US$0.08 cada
  una según el proveedor/calidad → **US$0.10-1.00 por episodio**.
- **Ensamblado de video (ffmpeg):** costo de cómputo propio, no de API —
  despreciable comparado con lo anterior.

**Total aproximado por episodio: entre US$0.20 y US$1.50**, muy por debajo
de lo que costaría cualquier enfoque de "video generado por IA" cuadro a
cuadro (que hoy arranca en varios dólares por pocos segundos de video).
Esto valida que el modelo es sostenible para ofrecerlo a familias a un
precio accesible.

## 8. Roadmap sugerido

- **Fase 0 — hecho:** arquitectura + prototipo con pipeline completo
  verificado (este documento y el código entregado).
- **Fase 1:** conectar un proveedor real de imágenes con referencia de
  personaje y un proveedor real de voz en español; subida de fotos de
  personajes desde el frontend; cola de trabajos para que el render no
  bloquee al usuario; moderación básica del guion básico antes de mandarlo
  a Claude.
- **Fase 2:** biblioteca completa "Mi Serie" con temporadas, autoplay del
  siguiente capítulo, animación liviana de personajes (parpadeo, boca
  sincronizada) para sumar "vida" sin disparar costos; cuentas de familia.
- **Fase 3:** explorar la salida a un dispositivo dedicado (Arduino /
  pantalla física), una vez validada la versión web con familias reales.

## 9. Riesgos y cuidados a tener en cuenta

- **Fotos de chicos y mascotas:** al subir fotos reales como referencia
  de personajes, hay que ser explícitos con el consentimiento de los
  padres, dónde se almacenan esas fotos, y por cuánto tiempo — es dato
  sensible.
- **Moderación de contenido:** aunque el system prompt de Claude ya
  impone reglas de contenido apto para chicos, conviene sumar una revisión
  automática (o incluso manual en el arranque) del guion básico que
  ingresan las familias, para evitar que alguien intente meter contenido
  inapropiado por esa vía.
- **Consistencia visual:** la calidad de "personaje consistente" depende
  100% del proveedor de imágenes elegido — conviene probar 2-3 opciones
  con fotos reales de mascotas/familiares antes de comprometerse a una.

---

## Fuentes usadas para los datos de costos y proveedores (2026)

- [gpt-4o-mini-tts: Cheapest TTS API in 2026 — TokenMix](https://tokenmix.ai/blog/gpt-4o-mini-tts-cheapest-tts-api-2026)
- [OpenAI TTS Pricing 2026 — TextToLab](https://texttolab.com/blog/openai-tts-pricing)
- [How to Create Consistent Characters with AI (2026 Guide) — getimg.ai](https://getimg.ai/blog/how-to-create-consistent-characters-with-ai)
- [10 Best AI Image Generators in 2026 — fal.ai](https://fal.ai/learn/tools/ai-image-generators)
- [Remotion — License and terms](https://www.remotion.dev/docs/license) (evaluado como alternativa de ensamblado; se optó por ffmpeg directo para evitar cualquier duda de licenciamiento comercial en esta etapa)
