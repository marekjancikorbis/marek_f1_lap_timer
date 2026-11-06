"""Build the redesign mockups: src/<style>.html + a palette -> <page>.html, with real map paths filled in.

    python -X utf8 apps/web/design/redesigns/tools/build.py

Placeholders in src/*.html: {{palette}} (CSS custom properties), {{name}}, {{swatches}},
{{lens.wide}} / {{lens.round}} (displacement maps for the liquid glass filter),
and map keys from maps/maps.json such as {{full.s1}} or {{card.start.0}}.
"""
import json, pathlib, re, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAPS = json.loads((ROOT / 'maps' / 'maps.json').read_text())

FROST = {'s-p': '#c9b3ff', 's-g': '#8fe3bd', 's-y': '#f2d58a'}   # softened for muted palettes
DEEP = {'s-p': '#7a3fd0', 's-g': '#1f7a45', 's-y': '#9a7200'}    # deepened to read on light grounds

PAGES = {
    'glass': ('glass', 'Glass · Cloud', {
        'page': '#cdc8c1', 'ring': '#2a3440', 'night': '#d7d2cc',
        'main': '#304352', 'main-hi': '#304352', 'on-main': '#eeebe7',
        'accent': '#5d6c79', 'ink': '#304352', 'ink-2': 'rgba(48, 67, 82, .8)',
        'sheet': 'rgba(222, 218, 213, .45)', 'clear': 'rgba(255, 255, 255, .16)', 'glass-fx': 'saturate(1.1) brightness(1.04)',
        'map-full': 'url(maps/full-light.png)', 'map-drive': 'url(maps/drive-light.png)',
        'map-filter': 'grayscale(1) contrast(1.1)', 'map-tint': '#d7d2cc', 'map-blend': 'multiply',
        'blob-a': '#304352', 'blob-b': '#a3afba',
        **DEEP}, ['#d7d2cc', '#304352']),
    'glass-sleigh': ('glass', 'Glass · Sleigh', {
        'page': '#001f30', 'ring': '#0d1a22', 'night': '#012a42',
        'main': '#e22c2c', 'main-hi': '#ff9d95', 'on-main': '#f3efe6',
        'accent': '#f3efe6', 'ink': '#f3efe6', 'ink-2': 'rgba(243, 239, 230, .78)',
        'sheet': 'rgba(1, 38, 58, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.5) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#01507a', 'map-blend': 'color',
        'blob-a': '#0a6a9c', 'blob-b': '#e22c2c',
        **FROST}, ['#013f60', '#e22c2c', '#f3efe6']),
    'glass-bluenight': ('glass', 'Glass · Blue night', {
        'page': '#03152b', 'ring': '#0a1626', 'night': '#062041',
        'main': '#9fa8b7', 'main-hi': '#d5dae3', 'on-main': '#062041',
        'accent': '#a2abbd', 'ink': '#e6e9ef', 'ink-2': 'rgba(230, 233, 239, .74)',
        'sheet': 'rgba(6, 32, 65, .45)', 'clear': 'rgba(159, 168, 183, .08)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.35)', 'map-tint': '#0b3166', 'map-blend': 'color',
        'blob-a': '#9fa8b7', 'blob-b': '#1d4f8f',
        **FROST}, ['#062041', '#9fa8b7']),
    'glass-pine': ('glass', 'Glass · Frozen pine', {
        'page': '#071f27', 'ring': '#04141a', 'night': '#0b303c',
        'main': '#cdece2', 'main-hi': '#e8f7f2', 'on-main': '#0b303c',
        'accent': '#86b8ab', 'ink': '#e8f6f1', 'ink-2': 'rgba(232, 246, 241, .74)',
        'sheet': 'rgba(11, 48, 60, .45)', 'clear': 'rgba(205, 236, 226, .07)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#0f4a5c', 'map-blend': 'color',
        'blob-a': '#cdece2', 'blob-b': '#1b6b6b',
        **FROST}, ['#0b303c', '#cdece2']),
    'sleigh': ('sleigh', 'Sleigh', {
        'page': '#00263a', 'ring': '#0d1a22', 'sea': '#013f60', 'tile': '#0a4c71', 'deep': '#012f48',
        'red': '#e22c2c', 'on-red': '#f3efe6', 'red-ink': '#c41f1f', 'snow': '#f3efe6', 'snow-2': 'rgba(243, 239, 230, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#01507a', 'map-blend': 'color',
        's-p': '#c9b3ff', 's-g': '#8fe3bd', 's-y': '#f2d58a'}, ['#013f60', '#e22c2c', '#f3efe6']),
    'sleigh-forest': ('sleigh', 'Sleigh · Forest', {
        'page': '#06271d', 'ring': '#04140f', 'sea': '#0e4d3a', 'tile': '#175f49', 'deep': '#093a2b',
        'red': '#9be15d', 'on-red': '#0b2f22', 'red-ink': '#0e4d3a', 'snow': '#eef6e7', 'snow-2': 'rgba(238, 246, 231, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#0f6b4f', 'map-blend': 'color',
        # sector green leans to icy cyan so it never reads as the lime action colour
        's-p': '#c9b3ff', 's-g': '#94e2e6', 's-y': '#f2d58a'}, ['#0e4d3a', '#9be15d']),
    'quiet': ('quiet', 'Quiet', {
        'page': '#cdc8c1', 'ring': '#2a3440', 'cloud': '#d7d2cc', 'slate': '#304352',
        'slate-2': 'rgba(48, 67, 82, .82)', 'hair': 'rgba(48, 67, 82, .2)',
        'cloud-2': 'rgba(215, 210, 204, .85)', 'cloud-hair': 'rgba(215, 210, 204, .25)',
        's-p': '#7a3fd0', 's-g': '#1f7a45', 's-y': '#b88a00', 'i-p': '#a77cf0', 'i-g': '#5fd18f',
        'map-card': 'url(maps/card-light.png)', 'map-filter': 'grayscale(1) contrast(2.2) brightness(.92)', 'map-tint': '#d7d2cc', 'map-blend': 'multiply'},
        ['#d7d2cc', '#304352']),
    'quiet-pine': ('quiet', 'Quiet · Frozen Pine', {
        'page': '#08262f', 'ring': '#04141a', 'cloud': '#0b303c', 'slate': '#cdece2',
        'slate-2': 'rgba(205, 236, 226, .8)', 'hair': 'rgba(205, 236, 226, .2)',
        'cloud-2': 'rgba(11, 48, 60, .85)', 'cloud-hair': 'rgba(11, 48, 60, .25)',
        's-p': '#b892ff', 's-g': '#5fe0a0', 's-y': '#ffd24a', 'i-p': '#6a2fc0', 'i-g': '#17703f',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#0f4a5c', 'map-blend': 'color'},
        ['#0b303c', '#cdece2']),
}


def lens(rx_frac):
    """Displacement map: red ramps along x, blue along y, neutral grey in the middle so only the rim bends."""
    svg = (f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400' preserveAspectRatio='none'>"
           "<defs><linearGradient id='r' x1='1' x2='0'><stop offset='0' stop-color='#000'/><stop offset='1' stop-color='#f00'/></linearGradient>"
           "<linearGradient id='b' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#000'/><stop offset='1' stop-color='#00f'/></linearGradient>"
           "<filter id='f'><feGaussianBlur stdDeviation='22'/></filter></defs>"
           "<rect width='400' height='400' fill='url(#r)'/>"
           "<rect width='400' height='400' fill='url(#b)' style='mix-blend-mode:screen'/>"
           f"<rect x='34' y='34' width='332' height='332' rx='{int(166 * rx_frac)}' fill='#808080' filter='url(#f)'/></svg>")
    return 'data:image/svg+xml,' + urllib.parse.quote(svg)


def lookup(key):
    if key == 'lens.wide':
        return lens(.45)
    if key == 'lens.round':
        return lens(1)
    v = MAPS
    for part in key.split('.'):
        v = v[int(part)] if isinstance(v, list) else v[part]
    return str(v)


def main():
    for out, (src, name, palette, swatches) in PAGES.items():
        html = (ROOT / 'src' / f'{src}.html').read_text()
        css = ' '.join(f'--{k}: {v};' for k, v in palette.items())
        sw = ''.join(f'<i style="background:{c}"></i>' for c in swatches)
        html = html.replace('{{palette}}', css).replace('{{name}}', name).replace('{{swatches}}', sw)
        html = re.sub(r'\{\{([\w.]+)\}\}', lambda m: lookup(m.group(1)), html)
        (ROOT / f'{out}.html').write_text(html)
        print('wrote', out + '.html')


if __name__ == '__main__':
    main()
