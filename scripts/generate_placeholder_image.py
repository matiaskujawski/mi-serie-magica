#!/usr/bin/env python3
"""
Generador de imágenes "placeholder" para el prototipo.

Esto NO es el generador de arte final: es un reemplazo barato y offline
que dibuja una tarjeta con degradé + el texto de la escena, para poder
probar el pipeline completo (guion -> imagen -> audio -> video) sin
necesitar todavía una cuenta paga en un proveedor de imágenes por IA.

En producción, este script se reemplaza por una llamada a un proveedor
como fal.ai (Flux), getimg.ai (Elements / referencia de personaje) u
OpenAI Images, usando el campo "descripcion_visual" de cada escena como
prompt. Ver docs/arquitectura-tecnica.md, sección "Generación de imágenes".
"""
import sys
import json
import hashlib
import textwrap
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1280, 720

PALETTES = [
    ((255, 183, 94), (255, 94, 156)),
    ((94, 199, 255), (129, 94, 255)),
    ((129, 255, 178), (94, 199, 255)),
    ((255, 214, 94), (255, 140, 94)),
    ((198, 94, 255), (94, 143, 255)),
]


def pick_palette(seed_text):
    h = int(hashlib.sha256(seed_text.encode("utf-8")).hexdigest(), 16)
    return PALETTES[h % len(PALETTES)]


def make_gradient(size, color_top, color_bottom):
    base = Image.new("RGB", size, color_top)
    top = Image.new("RGB", size, color_bottom)
    mask = Image.new("L", size)
    mask_data = []
    for y in range(size[1]):
        mask_data.extend([int(255 * (y / size[1]))] * size[0])
    mask.putdata(mask_data)
    base.paste(top, (0, 0), mask)
    return base


def load_font(size):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_scene(out_path, scene_number, lugar, descripcion, personajes):
    color_top, color_bottom = pick_palette(descripcion or lugar or str(scene_number))
    img = make_gradient((WIDTH, HEIGHT), color_top, color_bottom)
    draw = ImageDraw.Draw(img)

    title_font = load_font(46)
    body_font = load_font(30)
    tag_font = load_font(26)

    # Panel semi-transparente para legibilidad
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    odraw.rectangle([60, 60, WIDTH - 60, HEIGHT - 60], fill=(20, 20, 30, 110))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    draw.text((100, 90), f"Escena {scene_number} · {lugar}", font=title_font, fill=(255, 255, 255))

    wrapped = textwrap.wrap(descripcion, width=46)
    y = 190
    for line in wrapped[:8]:
        draw.text((100, y), line, font=body_font, fill=(255, 255, 255))
        y += 42

    if personajes:
        tag = "  ".join(f"@{p}" for p in personajes)
        draw.text((100, HEIGHT - 110), tag, font=tag_font, fill=(255, 230, 150))

    draw.text((100, HEIGHT - 70), "PLACEHOLDER — reemplazar por generador de imágenes real",
              font=tag_font, fill=(255, 255, 255))

    img.save(out_path, quality=92)


if __name__ == "__main__":
    payload = json.loads(sys.argv[1])
    draw_scene(
        out_path=payload["out_path"],
        scene_number=payload["numero"],
        lugar=payload.get("lugar", ""),
        descripcion=payload.get("descripcion_visual", ""),
        personajes=payload.get("personajes_en_escena", []),
    )
    print(json.dumps({"ok": True, "out_path": payload["out_path"]}))
