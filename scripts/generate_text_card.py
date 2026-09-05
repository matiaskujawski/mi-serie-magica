#!/usr/bin/env python3
"""
Genera una tarjeta de texto simple (portada / cartel de cierre / CTA),
reutilizable tanto para el video horizontal como para el clip vertical
de redes. Placeholder visual — en producción esto sería parte del arte
de marca de la serie (se genera una sola vez, no por escena).
"""
import sys
import json
import textwrap
from PIL import Image, ImageDraw, ImageFont

TOP_COLOR = (40, 24, 74)
BOTTOM_COLOR = (94, 46, 130)


def make_gradient(size, color_top, color_bottom):
    base = Image.new("RGB", size, color_top)
    top = Image.new("RGB", size, color_bottom)
    mask = Image.new("L", size)
    mask.putdata([int(255 * (y / size[1])) for y in range(size[1]) for _ in range(size[0])])
    base.paste(top, (0, 0), mask)
    return base


def load_font(size, bold=True):
    path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else \
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def draw_card(out_path, width, height, title, subtitle, badge):
    img = make_gradient((width, height), TOP_COLOR, BOTTOM_COLOR)
    draw = ImageDraw.Draw(img)

    title_size = max(36, width // 14)
    subtitle_size = max(22, width // 28)
    title_font = load_font(title_size)
    subtitle_font = load_font(subtitle_size, bold=False)
    badge_font = load_font(max(20, width // 34))

    wrap_width = max(10, width // (title_size // 2))
    lines = textwrap.wrap(title, width=wrap_width)
    total_h = len(lines) * (title_size + 14)
    y = height // 2 - total_h // 2 - 40
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=title_font)
        w = bbox[2] - bbox[0]
        draw.text(((width - w) / 2, y), line, font=title_font, fill=(255, 255, 255))
        y += title_size + 14

    if subtitle:
        sub_lines = textwrap.wrap(subtitle, width=wrap_width + 6)
        y += 20
        for line in sub_lines:
            bbox = draw.textbbox((0, 0), line, font=subtitle_font)
            w = bbox[2] - bbox[0]
            draw.text(((width - w) / 2, y), line, font=subtitle_font, fill=(255, 224, 168))
            y += subtitle_size + 10

    if badge:
        bbox = draw.textbbox((0, 0), badge, font=badge_font)
        w = bbox[2] - bbox[0]
        draw.text(((width - w) / 2, height - int(height * 0.12)), badge, font=badge_font, fill=(255, 255, 255))

    img.save(out_path, quality=92)


if __name__ == "__main__":
    payload = json.loads(sys.argv[1])
    draw_card(
        out_path=payload["out_path"],
        width=payload.get("width", 1080),
        height=payload.get("height", 1920),
        title=payload.get("title", ""),
        subtitle=payload.get("subtitle", ""),
        badge=payload.get("badge", ""),
    )
    print(json.dumps({"ok": True, "out_path": payload["out_path"]}))
