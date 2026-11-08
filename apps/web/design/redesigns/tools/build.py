"""Build the redesign mockups: src/<style>.html + a palette -> <page>.html, with real map paths filled in.

    python -X utf8 apps/web/design/redesigns/tools/build.py

Placeholders in src/*.html: {{palette}} (CSS custom properties), {{name}}, {{swatches}},
and map keys from maps/maps.json such as {{full.s1}} or {{card.start.0}}.
"""
import html as H, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAPS = json.loads((ROOT / 'maps' / 'maps.json').read_text())

VIVID = {'s-p': '#9d5cff', 's-g': '#1fd27a', 's-y': '#ffbe1a'}   # sector colours, the same in every design and palette

PAGES = {
    'glass-sleigh': ('glass', 'Glass · Navy & red', {
        'page': '#001f30', 'ring': '#0d1a22', 'night': '#012a42',
        'main': '#e22c2c', 'main-hi': '#ff9d95', 'on-main': '#f3efe6',
        'accent': '#f3efe6', 'ink': '#f3efe6', 'ink-2': 'rgba(243, 239, 230, .78)',
        'sheet': 'rgba(1, 38, 58, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.5) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#01507a', 'map-blend': 'color',
        'blob-a': '#0a6a9c', 'blob-b': '#e22c2c',
        **VIVID}, ['#013f60', '#e22c2c', '#f3efe6']),
    'glass-pine': ('glass', 'Glass · Teal & mint', {
        'page': '#071f27', 'ring': '#04141a', 'night': '#0b303c',
        'main': '#cdece2', 'main-hi': '#e8f7f2', 'on-main': '#0b303c',
        'accent': '#86b8ab', 'ink': '#e8f6f1', 'ink-2': 'rgba(232, 246, 241, .74)',
        'sheet': 'rgba(11, 48, 60, .45)', 'clear': 'rgba(205, 236, 226, .07)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#0f4a5c', 'map-blend': 'color',
        'blob-a': '#cdece2', 'blob-b': '#1b6b6b',
        **VIVID}, ['#0b303c', '#cdece2']),
    'glass-midnight': ('glass', 'Glass · Indigo', {
        'page': '#060920', 'ring': '#04061a', 'night': '#0b1033',
        'main': '#5b4bff', 'main-hi': '#a79eff', 'on-main': '#ffffff',
        'accent': '#a79eff', 'ink': '#eceeff', 'ink-2': 'rgba(236, 238, 255, .74)',
        'sheet': 'rgba(11, 16, 51, .45)', 'clear': 'rgba(91, 75, 255, .07)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.35)', 'map-tint': '#1a1f66', 'map-blend': 'color',
        'blob-a': '#5b4bff', 'blob-b': '#1d2a8f',
        **VIVID}, ['#0b1033', '#5b4bff']),
    'glass-forest': ('glass', 'Glass · Green', {
        'page': '#06271d', 'ring': '#04140f', 'night': '#0e4d3a',
        'main': '#9be15d', 'main-hi': '#c9f29f', 'on-main': '#0b2f22',
        'accent': '#b9e893', 'ink': '#eef6e7', 'ink-2': 'rgba(238, 246, 231, .74)',
        'sheet': 'rgba(14, 77, 58, .45)', 'clear': 'rgba(155, 225, 93, .06)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#0f6b4f', 'map-blend': 'color',
        'blob-a': '#9be15d', 'blob-b': '#1a7a5a',
        **VIVID}, ['#0e4d3a', '#9be15d']),
    'glass-cobalt': ('glass', 'Glass · Lavender & lime', {
        'page': '#080a12', 'ring': '#05060b', 'night': '#10121c',
        'main': '#c4b5ff', 'main-hi': '#e4dcff', 'on-main': '#14112b',
        'accent': '#c6ff3d', 'ink': '#f0edff', 'ink-2': 'rgba(240, 237, 255, .74)',
        'sheet': 'rgba(16, 18, 40, .45)', 'clear': 'rgba(196, 181, 255, .07)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.35)', 'map-tint': '#1d1f4a', 'map-blend': 'color',
        'blob-a': '#c4b5ff', 'blob-b': '#6f5bd6', 'blob-c': '#d8ff2e',
        **VIVID}, ['#10121c', '#c4b5ff', '#c6ff3d']),
    'glass-crimson': ('glass', 'Glass · Red & yellow', {
        'page': '#5c0816', 'ring': '#2a0409', 'night': '#7a0c1f',
        'main': '#ffe03a', 'main-hi': '#fff09a', 'on-main': '#5c0816',
        'accent': '#ffe03a', 'ink': '#fff7ec', 'ink-2': 'rgba(255, 247, 236, .78)',
        'sheet': 'rgba(110, 10, 27, .45)', 'clear': 'rgba(255, 224, 58, .05)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#a3122a', 'map-blend': 'color',
        'blob-a': '#d81e3a', 'blob-b': '#4a0612',
        **VIVID}, ['#a3122a', '#7a0c1f', '#ffe03a']),
    'sleigh': ('sleigh', 'Tiles · Navy & red', {
        'page': '#00263a', 'ring': '#0d1a22', 'sea': '#013f60', 'tile': '#0a4c71', 'deep': '#012f48',
        'red': '#e22c2c', 'on-red': '#f3efe6', 'red-ink': '#c41f1f', 'snow': '#f3efe6', 'snow-2': 'rgba(243, 239, 230, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#01507a', 'map-blend': 'color',
        **VIVID}, ['#013f60', '#e22c2c', '#f3efe6']),
    'sleigh-forest': ('sleigh', 'Tiles · Green', {
        'page': '#06271d', 'ring': '#04140f', 'sea': '#0e4d3a', 'tile': '#175f49', 'deep': '#093a2b',
        'red': '#9be15d', 'on-red': '#0b2f22', 'red-ink': '#0e4d3a', 'snow': '#eef6e7', 'snow-2': 'rgba(238, 246, 231, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#0f6b4f', 'map-blend': 'color',
        **VIVID}, ['#0e4d3a', '#9be15d']),
    'sleigh-midnight': ('sleigh', 'Tiles · Indigo', {
        'page': '#060920', 'ring': '#04061a', 'sea': '#0b1033', 'tile': '#161c4d', 'deep': '#080c28',
        'red': '#5b4bff', 'on-red': '#ffffff', 'red-ink': '#4a3be0', 'snow': '#eceeff', 'snow-2': 'rgba(236, 238, 255, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#1a1f66', 'map-blend': 'color',
        **VIVID}, ['#0b1033', '#5b4bff']),
    'sleigh-cobalt': ('sleigh', 'Tiles · Lavender & lime', {
        'page': '#080a12', 'ring': '#05060b', 'sea': '#10121c', 'tile': '#1c1d33', 'deep': '#0b0c15',
        'red': '#c6ff3d', 'on-red': '#14112b', 'red-ink': '#2a2350', 'snow': '#ece6ff', 'snow-2': 'rgba(236, 230, 255, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#1d1f4a', 'map-blend': 'color',
        **VIVID}, ['#10121c', '#c4b5ff', '#c6ff3d']),
    'sleigh-crimson': ('sleigh', 'Tiles · Red & yellow', {
        'page': '#6e0a1b', 'ring': '#2a0409', 'sea': '#a3122a', 'tile': '#8a0f24', 'deep': '#7a0c1f',
        'red': '#ffe03a', 'on-red': '#6e0a1b', 'red-ink': '#a3122a', 'snow': '#fff7ec', 'snow-2': 'rgba(255, 247, 236, .82)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#a3122a', 'map-blend': 'color',
        **VIVID}, ['#a3122a', '#7a0c1f', '#ffe03a']),
    'bento-mono': ('bento', 'Glass tiles · Mono', {
        'page': '#0b0b0c', 'ring': '#050506', 'night': '#141416', 'sea': '#121214', 'tile': '#1e1e21', 'deep': '#0e0e10',
        'main': '#f2f2f3', 'main-hi': '#ffffff', 'on-main': '#111113', 'accent': '#ffffff', 'ink': '#f4f4f5', 'ink-2': 'rgba(244, 244, 245, .7)',
        'red': '#f2f2f3', 'on-red': '#111113', 'red-ink': '#111113', 'snow': '#f4f4f5', 'snow-2': 'rgba(244, 244, 245, .8)',
        'sheet': 'rgba(30, 30, 34, .45)', 'clear': 'rgba(255, 255, 255, .06)', 'glass-fx': 'saturate(1) brightness(1.08)',
        'map-full': 'url(maps/full-dark.png)', 'map-drive': 'url(maps/drive-dark.png)', 'map-card': 'url(maps/card-dark.png)',
        'map-filter': 'grayscale(1) brightness(1.3)', 'map-tint': '#2a2a2e', 'map-blend': 'color',
        'blob-a': '#6b6b72', 'blob-b': '#2c2c31', 'blob-c': 'transparent',
        **VIVID}, ['#141416', '#f4f4f5']),
    'bento-sleigh': ('bento', 'Glass tiles · Navy & red', {
        'page': '#00263a', 'ring': '#0d1a22', 'sea': '#013f60', 'tile': '#0a4c71', 'deep': '#012f48',
        'red': '#e22c2c', 'on-red': '#f3efe6', 'red-ink': '#c41f1f', 'snow': '#f3efe6', 'snow-2': 'rgba(243, 239, 230, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#01507a', 'map-blend': 'color',
        'sheet': 'rgba(1, 38, 58, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'blob-a': '#0a6a9c', 'blob-b': '#e22c2c',
        **VIVID}, ['#013f60', '#e22c2c', '#f3efe6']),
    'bento-cobalt': ('bento', 'Glass tiles · Lavender & lime', {
        'page': '#080a12', 'ring': '#05060b', 'sea': '#10121c', 'tile': '#1c1d33', 'deep': '#0b0c15',
        'red': '#c6ff3d', 'on-red': '#14112b', 'red-ink': '#2a2350', 'snow': '#ece6ff', 'snow-2': 'rgba(236, 230, 255, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#1d1f4a', 'map-blend': 'color',
        'sheet': 'rgba(16, 18, 40, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'blob-a': '#c4b5ff', 'blob-b': '#6f5bd6', 'blob-c': 'transparent',
        **VIVID}, ['#10121c', '#c4b5ff', '#c6ff3d']),
    'bento-crimson': ('bento', 'Glass tiles · Red & yellow', {
        'page': '#5c0816', 'ring': '#2a0409', 'sea': '#7a0c1f', 'tile': '#8a0f24', 'deep': '#5c0816',
        'red': '#ffe03a', 'on-red': '#5c0816', 'red-ink': '#a3122a', 'snow': '#fff7ec', 'snow-2': 'rgba(255, 247, 236, .82)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#a3122a', 'map-blend': 'color',
        'sheet': 'rgba(110, 10, 27, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'blob-a': '#d81e3a', 'blob-b': '#4a0612',
        **VIVID}, ['#a3122a', '#7a0c1f', '#ffe03a']),
    'bento-midnight': ('bento', 'Glass tiles · Indigo', {
        'page': '#060920', 'ring': '#04061a', 'sea': '#0b1033', 'tile': '#161c4d', 'deep': '#080c28',
        'red': '#5b4bff', 'on-red': '#ffffff', 'red-ink': '#4a3be0', 'snow': '#eceeff', 'snow-2': 'rgba(236, 238, 255, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.4)', 'map-tint': '#1a1f66', 'map-blend': 'color',
        'sheet': 'rgba(11, 16, 51, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'blob-a': '#5b4bff', 'blob-b': '#1d2a8f',
        **VIVID}, ['#0b1033', '#5b4bff']),
    'bento-forest': ('bento', 'Glass tiles · Green', {
        'page': '#06271d', 'ring': '#04140f', 'sea': '#0e4d3a', 'tile': '#175f49', 'deep': '#093a2b',
        'red': '#9be15d', 'on-red': '#0b2f22', 'red-ink': '#0e4d3a', 'snow': '#eef6e7', 'snow-2': 'rgba(238, 246, 231, .8)',
        'map-card': 'url(maps/card-dark.png)', 'map-filter': 'grayscale(1) brightness(1.5)', 'map-tint': '#0f6b4f', 'map-blend': 'color',
        'sheet': 'rgba(14, 77, 58, .45)', 'clear': 'rgba(243, 239, 230, .06)', 'glass-fx': 'saturate(1.3) brightness(1.08)',
        'blob-a': '#9be15d', 'blob-b': '#1a7a5a',
        **VIVID}, ['#0e4d3a', '#9be15d']),
}

# Glass bento uses the Glass screens too, so each bento palette starts from the Glass palette of the same name.
for _name, (_src, _title, _pal, _sw) in list(PAGES.items()):
    if _src == 'bento':
        base = PAGES.get('glass-' + _name.split('-', 1)[1])  # Mono has no Glass twin: its palette is complete
        PAGES[_name] = (_src, _title, {**(base[2] if base else {}), **_pal}, _sw)



def lookup(key):
    if key == 'glassjs':
        return (ROOT / 'tools' / 'glass.js').read_text(encoding='utf8')
    v = MAPS
    for part in key.split('.'):
        v = v[int(part)] if isinstance(v, list) else v[part]
    return str(v)


def themes(src, current):
    """The theme picker in Settings: one swatch per palette of this design, each a link to that palette's page."""
    out = []
    for page, (s, title, _, sw) in PAGES.items():
        if s != src:
            continue
        stops = ', '.join(f'{c} {i * 100 // len(sw)}% {(i + 1) * 100 // len(sw)}%' for i, c in enumerate(sw))
        on = page == current
        out.append(f'<a class="theme{" on" if on else ""}" href="{page}.html#settings"{" aria-current=\"true\"" if on else ""}>'
                   f'<i style="background:conic-gradient(from 225deg, {stops})"></i><span>{H.escape(title.split(" · ")[-1])}</span></a>')
    return ''.join(out)


def main():
    for out, (src, name, palette, swatches) in PAGES.items():
        html = (ROOT / 'src' / f'{src}.html').read_text()
        css = ' '.join(f'--{k}: {v};' for k, v in palette.items())
        sw = ''.join(f'<i style="background:{c}"></i>' for c in swatches)
        html = html.replace('{{palette}}', css).replace('{{name}}', H.escape(name)).replace('{{swatches}}', sw).replace('{{themes}}', themes(src, out))
        html = re.sub(r'\{\{([\w.]+)\}\}', lambda m: lookup(m.group(1)), html)
        (ROOT / f'{out}.html').write_text(html)
        print('wrote', out + '.html')


if __name__ == '__main__':
    main()
