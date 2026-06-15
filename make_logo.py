"""
Generates:
  1. logo.svg        — production SVG logo (mark + wordmark lockup + icon-only variant)
  2. logo-brand.png  — 1600×900 brand-sheet canvas for the design-philosophy skill output
"""

# ── 0. Paths ────────────────────────────────────────────────────────────────
import os, math
from pathlib import Path

PROJ    = Path(r"C:\Users\adilj\OneDrive\Documents\ClaudeApp\WSCprep")
FONTS   = Path(r"C:\Users\adilj\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\3a3f3c1c-98c4-4c00-8b4a-2af44fa8fce2\68554b02-b3df-4683-b657-9f4c716c88ec\skills\canvas-design\canvas-fonts")
CANVAS  = Path(r"C:\Users\adilj\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\3a3f3c1c-98c4-4c00-8b4a-2af44fa8fce2\68554b02-b3df-4683-b657-9f4c716c88ec\skills\canvas-design")

# ── 1. Colours ───────────────────────────────────────────────────────────────
NAVY       = "#0F2E5C"
TEAL       = "#007A8A"
TEAL_LIGHT = "#00A3B8"
WHITE      = "#FFFFFF"
OFF_WHITE  = "#F0F5F8"
MID_GRAY   = "#8FA3B1"
LIGHT_BG   = "#EBF3F7"

# ── 2. SVG Logo ──────────────────────────────────────────────────────────────
#
# The mark icon (64 × 64):
#   • Navy rounded-square background
#   • Thin teal baseline (datum)
#   • Secondary trace (lower flood event) in teal
#   • Main hydrograph trace in white — steep rising limb, gradual falling limb
#   • Small teal circle at the peak
#
# Hydrograph path logic (inner working area 10–54 × 10–54):
#   Rising limb fast (flood response), falling limb slow (groundwater recession)
#   M 10,44  start at left, just above baseline
#   C 13,44  16,28  21,18   — rises steeply
#   C 25,9   28,9   31,10   — approaches peak
#   C 34,11  38,16  44,28   — broad crest into recession
#   C 48,36  51,42  54,44   — gentle tail

HYDROGRAPH_MAIN = "M 10,44 C 13,44 16,28 21,18 C 25,9 28,9 31,10 C 34,11 38,16 44,28 C 48,36 51,42 54,44"
HYDROGRAPH_SEC  = "M 10,48 C 15,48 20,44 26,38 C 30,34 33,31 36,30 C 40,29 44,35 50,44 C 52,46 53,48 54,48"
BASELINE        = "M 10,50 L 54,50"
PEAK_X, PEAK_Y  = 31, 10

# Full lockup: 280 × 64  (mark 64×64 + gap 16 + wordmark ~200)
SVG_LOCKUP = f"""<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 280 64" width="280" height="64"
     role="img" aria-label="WSCprep logo">
  <title>WSCprep</title>

  <!-- ── MARK ── -->
  <g id="mark">
    <!-- Background pill -->
    <rect width="64" height="64" rx="13" fill="{NAVY}"/>

    <!-- Subtle inner grid (barely visible) -->
    <line x1="10" y1="22" x2="54" y2="22" stroke="{WHITE}" stroke-opacity="0.06" stroke-width="0.6"/>
    <line x1="10" y1="36" x2="54" y2="36" stroke="{WHITE}" stroke-opacity="0.06" stroke-width="0.6"/>

    <!-- Baseline / datum -->
    <path d="{BASELINE}" stroke="{TEAL}" stroke-width="1.4"
          stroke-linecap="round" fill="none" stroke-opacity="0.9"/>

    <!-- Secondary trace (smaller event) -->
    <path d="{HYDROGRAPH_SEC}" stroke="{TEAL}" stroke-width="1.3"
          stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-opacity="0.75"/>

    <!-- Main hydrograph trace -->
    <path d="{HYDROGRAPH_MAIN}" stroke="{WHITE}" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round" fill="none"/>

    <!-- Peak marker -->
    <circle cx="{PEAK_X}" cy="{PEAK_Y}" r="2.6" fill="{TEAL_LIGHT}"/>
    <circle cx="{PEAK_X}" cy="{PEAK_Y}" r="1.2" fill="{WHITE}"/>
  </g>

  <!-- ── WORDMARK ── -->
  <g id="wordmark" font-family="'Instrument Sans','InstrumentSans','Inter','-apple-system','BlinkMacSystemFont','Segoe UI',sans-serif">
    <!-- "WSC" bold navy -->
    <text x="80" y="43"
          font-size="30" font-weight="700" letter-spacing="-0.8"
          fill="{NAVY}">WSC</text>
    <!-- "prep" regular teal — positioned after WSC (approx 78px wide at 30px bold) -->
    <text x="155" y="43"
          font-size="30" font-weight="400" letter-spacing="-0.4"
          fill="{TEAL}">prep</text>
  </g>

  <!-- Fine separator dot between WSC and prep -->
  <circle cx="149" cy="40" r="1.8" fill="{TEAL}" opacity="0.5"/>
</svg>"""

# Icon-only variant (64 × 64)
SVG_ICON = f"""<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 64 64" width="64" height="64"
     role="img" aria-label="WSCprep icon">
  <title>WSCprep</title>
  <rect width="64" height="64" rx="13" fill="{NAVY}"/>
  <line x1="10" y1="22" x2="54" y2="22" stroke="{WHITE}" stroke-opacity="0.06" stroke-width="0.6"/>
  <line x1="10" y1="36" x2="54" y2="36" stroke="{WHITE}" stroke-opacity="0.06" stroke-width="0.6"/>
  <path d="{BASELINE}" stroke="{TEAL}" stroke-width="1.4" stroke-linecap="round" fill="none" stroke-opacity="0.9"/>
  <path d="{HYDROGRAPH_SEC}" stroke="{TEAL}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-opacity="0.75"/>
  <path d="{HYDROGRAPH_MAIN}" stroke="{WHITE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="{PEAK_X}" cy="{PEAK_Y}" r="2.6" fill="{TEAL_LIGHT}"/>
  <circle cx="{PEAK_X}" cy="{PEAK_Y}" r="1.2" fill="{WHITE}"/>
</svg>"""

# Combined SVG with both variants declared
SVG_FULL = f"""<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 280 64" width="280" height="64">
  <title>WSCprep — Canadian Hydrometric Analysis</title>
  <defs>
    <style>
      .wsc-mark-bg   {{ fill: {NAVY}; }}
      .wsc-grid      {{ stroke: {WHITE}; stroke-opacity: 0.06; stroke-width: 0.6; fill: none; }}
      .wsc-baseline  {{ stroke: {TEAL}; stroke-width: 1.4; stroke-linecap: round; fill: none; stroke-opacity: 0.9; }}
      .wsc-trace-sec {{ stroke: {TEAL}; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; fill: none; stroke-opacity: 0.75; }}
      .wsc-trace     {{ stroke: {WHITE}; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; fill: none; }}
      .wsc-peak-ring {{ fill: {TEAL_LIGHT}; }}
      .wsc-peak-dot  {{ fill: {WHITE}; }}
      .wsc-sep       {{ fill: {TEAL}; opacity: 0.45; }}
    </style>
  </defs>

  <!-- ── MARK ── -->
  <rect width="64" height="64" rx="13" class="wsc-mark-bg"/>
  <line x1="10" y1="22" x2="54" y2="22" class="wsc-grid"/>
  <line x1="10" y1="36" x2="54" y2="36" class="wsc-grid"/>
  <path d="{BASELINE}"        class="wsc-baseline"/>
  <path d="{HYDROGRAPH_SEC}"  class="wsc-trace-sec"/>
  <path d="{HYDROGRAPH_MAIN}" class="wsc-trace"/>
  <circle cx="{PEAK_X}" cy="{PEAK_Y}" r="2.6" class="wsc-peak-ring"/>
  <circle cx="{PEAK_X}" cy="{PEAK_Y}" r="1.2"  class="wsc-peak-dot"/>

  <!-- ── WORDMARK ── -->
  <g font-family="'Instrument Sans','Inter','-apple-system','BlinkMacSystemFont','Segoe UI',sans-serif">
    <text x="80"  y="43" font-size="30" font-weight="700" letter-spacing="-0.8" fill="{NAVY}">WSC</text>
    <text x="155" y="43" font-size="30" font-weight="400" letter-spacing="-0.4" fill="{TEAL}">prep</text>
  </g>
  <circle cx="149" cy="40" r="1.8" class="wsc-sep"/>
</svg>"""

svg_path = PROJ / "logo.svg"
svg_path.write_text(SVG_FULL, encoding="utf-8")
print(f"Saved SVG: {svg_path}")


# ── 3. Brand-sheet PNG ────────────────────────────────────────────────────────
from PIL import Image, ImageDraw, ImageFont
import struct, zlib

W, H = 1600, 900

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

NAVY_RGB       = hex_to_rgb(NAVY)
TEAL_RGB       = hex_to_rgb(TEAL)
TEAL_LIGHT_RGB = hex_to_rgb(TEAL_LIGHT)
WHITE_RGB      = hex_to_rgb(WHITE)
OFF_WHITE_RGB  = hex_to_rgb(OFF_WHITE)
LIGHT_BG_RGB   = hex_to_rgb(LIGHT_BG)
MID_GRAY_RGB   = hex_to_rgb(MID_GRAY)

def load_font(name, size):
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except:
        return ImageFont.load_default()

# Fonts
f_bold   = load_font("InstrumentSans-Bold.ttf",    48)
f_reg    = load_font("InstrumentSans-Regular.ttf",  48)
f_bold_s = load_font("InstrumentSans-Bold.ttf",    28)
f_reg_s  = load_font("InstrumentSans-Regular.ttf",  28)
f_bold_xs= load_font("InstrumentSans-Bold.ttf",    16)
f_reg_xs = load_font("InstrumentSans-Regular.ttf",  14)
f_italic = load_font("InstrumentSans-Italic.ttf",  15)
f_bold_lg= load_font("InstrumentSans-Bold.ttf",    72)
f_reg_lg = load_font("InstrumentSans-Regular.ttf",  72)
f_mono   = load_font("JetBrainsMono-Regular.ttf",  13)

img  = Image.new("RGB", (W, H), NAVY_RGB)
draw = ImageDraw.Draw(img)


# ── helpers ──────────────────────────────────────────────────────────────────
def draw_rounded_rect(draw, x0, y0, x1, y1, r, fill=None, outline=None, width=1):
    """Draw a rounded rectangle."""
    if fill:
        draw.rectangle([x0+r, y0, x1-r, y1], fill=fill)
        draw.rectangle([x0, y0+r, x1, y1-r], fill=fill)
        draw.ellipse([x0, y0, x0+2*r, y0+2*r], fill=fill)
        draw.ellipse([x1-2*r, y0, x1, y0+2*r], fill=fill)
        draw.ellipse([x0, y1-2*r, x0+2*r, y1], fill=fill)
        draw.ellipse([x1-2*r, y1-2*r, x1, y1], fill=fill)
    if outline:
        draw.arc([x0, y0, x0+2*r, y0+2*r], 180, 270, fill=outline, width=width)
        draw.arc([x1-2*r, y0, x1, y0+2*r], 270, 360, fill=outline, width=width)
        draw.arc([x0, y1-2*r, x0+2*r, y1], 90, 180, fill=outline, width=width)
        draw.arc([x1-2*r, y1-2*r, x1, y1], 0, 90, fill=outline, width=width)
        draw.line([x0+r, y0, x1-r, y0], fill=outline, width=width)
        draw.line([x0+r, y1, x1-r, y1], fill=outline, width=width)
        draw.line([x0, y0+r, x0, y1-r], fill=outline, width=width)
        draw.line([x1, y0+r, x1, y1-r], fill=outline, width=width)

def catmull_rom_points(pts, steps=60):
    """Generate smooth curve points through control points."""
    result = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(i-1, 0)]
        p1 = pts[i]
        p2 = pts[i+1]
        p3 = pts[min(i+2, n-1)]
        for t in range(steps):
            tt  = t / steps
            tt2 = tt * tt
            tt3 = tt2 * tt
            x = 0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*tt +
                        (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*tt2 +
                        (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*tt3)
            y = 0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*tt +
                        (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*tt2 +
                        (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*tt3)
            result.append((x, y))
    result.append(pts[-1])
    return result


def draw_hydrograph(draw, cx, cy, scale=1.0, alpha=255):
    """Draw the hydrograph mark at centre (cx,cy), scaled."""
    s = scale
    # Working coords relative to top-left of mark
    ox = cx - 32*s
    oy = cy - 32*s

    def pt(x, y): return (ox + x*s, oy + y*s)

    # Baseline
    draw.line([pt(10,50), pt(54,50)],
              fill=(*TEAL_RGB, alpha), width=max(1, int(1.4*s)))

    # Secondary trace (lower flood)
    sec_pts = [pt(10,48), pt(15,48), pt(20,44), pt(26,38),
               pt(30,34), pt(33,31), pt(36,30), pt(40,29),
               pt(44,35), pt(50,44), pt(54,48)]
    sec_curve = catmull_rom_points(sec_pts, 40)
    if len(sec_curve) > 1:
        draw.line(sec_curve, fill=(*TEAL_RGB, int(alpha*0.7)),
                  width=max(1, int(1.3*s)))

    # Main trace (primary flood)
    main_pts = [pt(10,44), pt(13,44), pt(16,32), pt(21,20),
                pt(25,11), pt(28,9), pt(31,10),
                pt(34,11), pt(38,18), pt(44,30),
                pt(48,38), pt(51,43), pt(54,44)]
    main_curve = catmull_rom_points(main_pts, 60)
    if len(main_curve) > 1:
        draw.line(main_curve, fill=(*WHITE_RGB, alpha),
                  width=max(1, int(2.2*s)))

    # Peak dot
    px, py = pt(31, 10)
    r = 2.6*s
    draw.ellipse([px-r, py-r, px+r, py+r], fill=(*TEAL_LIGHT_RGB, alpha))
    r2 = 1.2*s
    draw.ellipse([px-r2, py-r2, px+r2, py+r2], fill=(*WHITE_RGB, alpha))


# ────────────────────────────────────────────────────────────────────────────
# LAYOUT
# ────────────────────────────────────────────────────────────────────────────
# The canvas is divided:
#   • Left column (0–840): dark navy — primary logo presentation
#   • Right column (840–1600): light (#EBF3F7) — reversed / light usage
#   • Bottom strip (760–900): colour palette + typography

# ── Thin vertical rule ───────────────────────────────────────────────────────
draw.line([(840, 60), (840, 760)], fill=(*TEAL_RGB, 30), width=1)

# ── LEFT PANEL — dark ────────────────────────────────────────────────────────

# Hero: large icon mark (centre of left panel)
MARK_SCALE = 4.0   # 64 × 4 = 256px mark
MARK_CX, MARK_CY = 200, 340

# Draw mark background
ms = 64 * MARK_SCALE
mx0 = MARK_CX - ms/2
my0 = MARK_CY - ms/2
draw_rounded_rect(draw,
    int(mx0), int(my0), int(mx0+ms), int(my0+ms),
    r=int(13*MARK_SCALE),
    fill=(*hex_to_rgb("#1A3F72"),))   # slightly lighter navy for the mark bg on dark canvas

# Very subtle grid inside the mark
for row_y in [22, 36]:
    gy = my0 + row_y * MARK_SCALE
    draw.line([(mx0+10*MARK_SCALE, gy), (mx0+54*MARK_SCALE, gy)],
              fill=(*WHITE_RGB, 10), width=1)

draw_hydrograph(draw, MARK_CX, MARK_CY, scale=MARK_SCALE)

# Wordmark next to the icon
wm_x = int(mx0 + ms + 40)
wm_y = MARK_CY - 52

# "WSC" bold
draw.text((wm_x, wm_y), "WSC", font=f_bold_lg, fill=WHITE_RGB)
wsc_w = draw.textlength("WSC", font=f_bold_lg)

# "prep" teal
draw.text((wm_x + wsc_w + 4, wm_y), "prep", font=f_reg_lg, fill=TEAL_RGB)

# Separator dot
sep_x = int(wm_x + wsc_w + 1)
sep_y = wm_y + 52
draw.ellipse([sep_x-3, sep_y-3, sep_x+3, sep_y+3],
             fill=(*TEAL_LIGHT_RGB, 100))

# Tagline under wordmark
tag_x = wm_x
tag_y = wm_y + 86
draw.text((tag_x, tag_y),
    "Canadian Hydrometric Analysis",
    font=f_reg_xs, fill=(*MID_GRAY_RGB,))

# URL
draw.text((tag_x, tag_y + 24),
    "ws-cprep.vercel.app",
    font=f_italic, fill=(*TEAL_LIGHT_RGB,))

# Small icon-only lockup (bottom-left of dark panel)
draw_rounded_rect(draw, 80, 560, 144, 624, r=10, fill=(*NAVY_RGB,))
draw_hydrograph(draw, 112, 592, scale=1.0)

draw.text((155, 577), "Icon mark", font=f_reg_xs, fill=(*MID_GRAY_RGB,))
draw.text((155, 597), "64 × 64 px", font=f_mono, fill=(*MID_GRAY_RGB, 160))

# Small full lockup sample (lower left, smaller size)
draw.text((80, 650), "WSC", font=f_bold_s, fill=WHITE_RGB)
wsc_s_w = draw.textlength("WSC", font=f_bold_s)
draw.text((80 + wsc_s_w + 3, 650), "prep", font=f_reg_s, fill=TEAL_RGB)
draw.text((80, 690), "Wordmark — 28 px", font=f_mono, fill=(*MID_GRAY_RGB, 160))

# Horizontal rule under hero
draw.line([(60, 490), (780, 490)], fill=(*TEAL_RGB, 25), width=1)

# Label "PRIMARY — on dark"
draw.text((60, 60), "PRIMARY", font=f_bold_xs, fill=(*MID_GRAY_RGB, 180))
draw.text((60, 80), "On Navy", font=f_reg_xs,  fill=(*MID_GRAY_RGB, 100))

# ── RIGHT PANEL — light ───────────────────────────────────────────────────────
draw.rectangle([841, 0, W, H], fill=OFF_WHITE_RGB)

# Light panel: the mark on a white card
CARD_X0, CARD_Y0 = 920, 100
CARD_X1, CARD_Y1 = 1540, 480

draw_rounded_rect(draw, CARD_X0, CARD_Y0, CARD_X1, CARD_Y1, r=20, fill=WHITE_RGB)

# Slightly offset mark on white card — navy background inside
MARK_S2 = 2.8
ms2 = 64 * MARK_S2
cx2, cy2 = 1060, 280
mx2 = cx2 - ms2/2
my2 = cy2 - ms2/2
draw_rounded_rect(draw,
    int(mx2), int(my2), int(mx2+ms2), int(my2+ms2),
    r=int(13*MARK_S2), fill=NAVY_RGB)
for row_y in [22, 36]:
    gy2 = my2 + row_y * MARK_S2
    draw.line([(mx2+10*MARK_S2, gy2), (mx2+54*MARK_S2, gy2)],
              fill=(*WHITE_RGB, 10), width=1)
draw_hydrograph(draw, cx2, cy2, scale=MARK_S2)

# Wordmark in navy on white card
wm2_x = int(mx2 + ms2 + 30)
wm2_y = cy2 - 36
draw.text((wm2_x, wm2_y), "WSC",  font=f_bold,  fill=NAVY_RGB)
wsc2_w = draw.textlength("WSC", font=f_bold)
draw.text((wm2_x + wsc2_w + 3, wm2_y), "prep", font=f_reg, fill=TEAL_RGB)
sep2_x = int(wm2_x + wsc2_w + 1)
sep2_y = wm2_y + 38
draw.ellipse([sep2_x-2, sep2_y-2, sep2_x+2, sep2_y+2],
             fill=(*TEAL_RGB, 90))

# Tag on light card
draw.text((wm2_x, wm2_y + 64),
    "Canadian Hydrometric Analysis",
    font=f_reg_xs, fill=(*hex_to_rgb("#8FA3B1"),))

# Light panel label
draw.text((920, 60), "REVERSED", font=f_bold_xs, fill=(*hex_to_rgb("#8FA3B1"), 200))
draw.text((920, 80), "On White",  font=f_reg_xs,  fill=(*hex_to_rgb("#8FA3B1"), 120))

# Small swatches of teal-only and navy-only on light bg (lower right)
swatch_y = 510
draw.text((920, swatch_y), "CLEARSPACE & SCALE", font=f_bold_xs, fill=(*MID_GRAY_RGB, 180))
swatch_y += 28

sizes = [(1.0, 64), (1.6, 102), (2.2, 140)]
sx = 920
for scale, label_px in sizes:
    ms_s = int(64 * scale)
    scx = sx + ms_s//2
    scy = swatch_y + ms_s//2
    draw_rounded_rect(draw, sx, swatch_y, sx+ms_s, swatch_y+ms_s,
                      r=int(13*scale), fill=NAVY_RGB)
    draw_hydrograph(draw, scx, scy, scale=scale)
    draw.text((sx + ms_s//2 - 12, swatch_y + ms_s + 8),
              f"{label_px}px",
              font=f_mono, fill=(*MID_GRAY_RGB, 160))
    sx += ms_s + 50


# ── BOTTOM STRIP — Palette + Type ─────────────────────────────────────────────
strip_y = 760
draw.rectangle([0, strip_y, W, H], fill=(*hex_to_rgb("#0A2448"),))
draw.line([(0, strip_y), (W, strip_y)], fill=(*TEAL_RGB, 40), width=1)

# Colour swatches
colours = [
    (NAVY,       "Navy",        "#0F2E5C", "Primary"),
    (TEAL,       "Teal",        "#007A8A", "Accent"),
    (TEAL_LIGHT, "Teal Light",  "#00A3B8", "Highlight"),
    (WHITE,      "White",       "#FFFFFF",  "Text / BG"),
    (OFF_WHITE,  "Off-White",   "#F0F5F8", "Light BG"),
    (MID_GRAY,   "Mid Gray",    "#8FA3B1", "Secondary"),
]

sw_x = 80
sw_y = strip_y + 20
sw_w, sw_h = 60, 36

for hx, name, code, role in colours:
    rgb = hex_to_rgb(hx)
    draw_rounded_rect(draw, sw_x, sw_y, sw_x+sw_w, sw_y+sw_h, r=6, fill=rgb)
    if hx == WHITE or hx == OFF_WHITE:
        draw_rounded_rect(draw, sw_x, sw_y, sw_x+sw_w, sw_y+sw_h, r=6,
                          outline=(*MID_GRAY_RGB, 60), width=1)
    draw.text((sw_x, sw_y + sw_h + 6),  name, font=f_reg_xs,  fill=(*MID_GRAY_RGB,))
    draw.text((sw_x, sw_y + sw_h + 22), code, font=f_mono,    fill=(*MID_GRAY_RGB, 140))
    sw_x += 120

# Typeface specimen (right side of strip)
draw.text((900, strip_y + 18),
    "InstrumentSans Bold — WSCprep",
    font=f_bold_s, fill=(*WHITE_RGB, 220))
draw.text((900, strip_y + 56),
    "InstrumentSans Regular — hydrometric data analysis",
    font=f_reg_xs, fill=(*MID_GRAY_RGB,))
draw.text((900, strip_y + 78),
    "JetBrainsMono — api.weather.gc.ca  ·  /api/stations/{id}",
    font=f_mono, fill=(*MID_GRAY_RGB, 140))

# ── Save PNG ──────────────────────────────────────────────────────────────────
png_path = CANVAS / "WSCprep-brand.png"
os.makedirs(str(CANVAS), exist_ok=True)
img.save(str(png_path), "PNG", optimize=True)
print(f"Saved PNG: {png_path}")
print(f"Saved SVG: {svg_path}")
