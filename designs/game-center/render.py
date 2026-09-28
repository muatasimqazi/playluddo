"""Game Center leaderboard and achievement images (1024x1024), in the app icon's style.

Run: python3 designs/game-center/render.py  (needs rsvg-convert and ImageMagick)
Upload the PNGs in App Store Connect → Game Center → the leaderboard and each achievement.
"""
import pathlib, subprocess

HERE = pathlib.Path(__file__).parent
INK = "#1e2720"
TILES = {"coral": "#df7a66", "green": "#90b593", "blue": "#86a8d0", "yellow": "#e2c47e", "gold": "#c99a4e"}
STAR = "M0 -150 L17 -116 L54 -111 L27 -85 L34 -48 L0 -66 L-34 -48 L-27 -85 L-54 -111 L-17 -116 Z"

TROPHY = f"""
<path d="M-95 -120 H95 V-35 C95 40 50 80 0 80 C-50 80 -95 40 -95 -35 Z" fill="{INK}"/>
<path d="M-95 -95 H-135 V-55 C-135 -15 -115 10 -85 15 M95 -95 H135 V-55 C135 -15 115 10 85 15"
      fill="none" stroke="{INK}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="-20" y="75" width="40" height="40" fill="{INK}"/>
<rect x="-75" y="110" width="150" height="32" rx="10" fill="{INK}"/>"""

PAWN = f"""
<circle cx="0" cy="-85" r="48" fill="{INK}"/>
<path d="M-40 -25 H40 L72 105 H-72 Z" fill="{INK}"/>
<rect x="-62" y="-38" width="124" height="26" rx="13" fill="{INK}"/>
<rect x="-95" y="98" width="190" height="40" rx="14" fill="{INK}"/>"""

LADDER = f"""
<rect x="-85" y="-140" width="24" height="280" rx="12" fill="{INK}"/>
<rect x="61" y="-140" width="24" height="280" rx="12" fill="{INK}"/>
""" + "".join(f'<rect x="-70" y="{y}" width="140" height="20" rx="8" fill="{INK}"/>' for y in (-100, -40, 20, 80))

def person(cx, cy, stroke):
    return (f'<g stroke="{stroke}" stroke-width="16" paint-order="stroke">'
            f'<circle cx="{cx}" cy="{cy - 62}" r="42" fill="{INK}"/>'
            f'<path d="M{cx - 78} {cy + 90} C{cx - 78} {cy + 12} {cx - 45} {cy - 5} {cx} {cy - 5} '
            f'C{cx + 45} {cy - 5} {cx + 78} {cy + 12} {cx + 78} {cy + 90} Z" fill="{INK}"/></g>')

PEOPLE = person(58, -10, "none") + person(-50, 30, TILES["blue"])

TEN = f"""
<text x="0" y="118" text-anchor="middle" font-family="Helvetica Neue" font-weight="800"
      font-size="210" letter-spacing="-12" fill="{INK}">10</text>
<path transform="translate(0 -52)" d="{STAR}" fill="{INK}"/>"""

# Leaderboard: the icon's four seat colors as rising bars, a gold star over the tallest.
BARS = "".join(
    f'<rect x="{x}" y="{225 - h}" width="104" height="{h}" rx="30" fill="{TILES[c]}"/>'
    for x, h, c in ((-250, 150, "blue"), (-122, 230, "green"), (6, 310, "yellow"), (134, 390, "coral"))
) + f'<path transform="translate(186 -140)" d="{STAR}" fill="#dbbf86"/>'

# name: (tile color, or None for no tile, glyph)
IMAGES = {
    "leaderboard_wins": (None, BARS),
    "first_win": ("coral", TROPHY),
    "ludo_win": ("green", PAWN),
    "snakes_win": ("yellow", LADDER),
    "online_win": ("blue", PEOPLE),
    "ten_wins": ("gold", TEN),
}

def svg(color, glyph):
    tile = f'<rect x="-235" y="-235" width="470" height="470" rx="96" fill="{TILES[color]}"/>' if color else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><radialGradient id="bg" cx="50%" cy="38%" r="70%">
<stop offset="0" stop-color="#2e4136"/><stop offset="1" stop-color="#18201b"/></radialGradient></defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<circle cx="512" cy="512" r="430" fill="none" stroke="#dbbf86" stroke-opacity="0.35" stroke-width="10"/>
<g transform="translate(512 512) rotate(-8)">
{tile}
{glyph}
</g></svg>"""

for name, (color, glyph) in IMAGES.items():
    src, out = HERE / f"{name}.svg", HERE / f"{name}.png"
    src.write_text(svg(color, glyph))
    subprocess.run(["rsvg-convert", "-w", "1024", "-h", "1024", "-b", "#18201b", str(src), "-o", str(out)], check=True)
    # App Store Connect wants opaque images at 72 dpi.
    subprocess.run(["magick", str(out), "-alpha", "off", "-density", "72", "-units", "PixelsPerInch", str(out)], check=True)
    print(out)
