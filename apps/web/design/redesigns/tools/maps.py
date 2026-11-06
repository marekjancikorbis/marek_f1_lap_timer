"""Render the real Mapbox maps used by the redesign mockups.

Run once (it calls the Mapbox Directions and Static Images APIs with the app's token):
    python -X utf8 apps/web/design/redesigns/tools/maps.py
Writes maps/*.png and maps/maps.json (SVG paths that line up with each flat map).
"""
import io, json, math, pathlib, re, urllib.parse, urllib.request
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / 'maps'
CONFIG = HERE.parents[2] / 'src' / 'lib' / 'config.ts'
TOKEN = re.search(r"pk\.[A-Za-z0-9._-]+", CONFIG.read_text()).group(0)
API = 'https://api.mapbox.com'
LENGTH_M = 3420          # the sample route: Ecce Homo hill-climb, first 3.42 km out of Sternberk
TILE = 512               # Mapbox GL world size at zoom 0


def get(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def world(p):
    x = (p[0] + 180) / 360 * TILE
    s = math.sin(math.radians(p[1]))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * TILE
    return x, y


def unworld(x, y):
    lon = x / TILE * 360 - 180
    n = math.pi - 2 * math.pi * y / TILE
    return lon, math.degrees(math.atan(math.sinh(n)))


def route():
    url = (f'{API}/directions/v5/mapbox/driving/17.3005,49.7362;17.3126,49.7445;17.3400,49.7600'
           f'?geometries=geojson&overview=full&access_token={TOKEN}')
    pts = json.loads(get(url))['routes'][0]['geometry']['coordinates']
    out, d = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        step = hav(a, b)
        if d + step >= LENGTH_M:
            t = (LENGTH_M - d) / step
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
            break
        d += step
        out.append(b)
    return out


def cut(pts, fractions):
    """Split a polyline at fractions of its length; returns len(fractions)+1 pieces."""
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + hav(a, b))
    total, pieces, cur, fi = cum[-1], [], [pts[0]], 0
    marks = [f * total for f in fractions]
    for i in range(1, len(pts)):
        while fi < len(marks) and cum[i] >= marks[fi]:
            t = (marks[fi] - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
            p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]
            cur.append(p); pieces.append(cur); cur = [p]; fi += 1
        cur.append(pts[i])
    pieces.append(cur)
    return pieces


def static(style, lon, lat, z, w, h, bearing=0, pitch=0, overlay=''):
    """One @2x static image, stitched from strips when taller than the API's 1280 px limit."""
    strips, img = math.ceil(h / 600), Image.new('RGB', (w * 2, h * 2))
    cx, cy = world((lon, lat))
    sh = h // strips
    for i in range(strips):
        top = i * sh
        hh = h - top if i == strips - 1 else sh
        # shift the centre so this strip shows rows top..top+hh of the full picture (flat maps only)
        oy = (top + hh / 2 - h / 2) / 2 ** z
        slon, slat = unworld(cx, cy + oy)
        ov = f'{overlay}/' if overlay else ''
        url = (f'{API}/styles/v1/mapbox/{style}/static/{ov}{slon:.6f},{slat:.6f},{z:.3f},{bearing},{pitch}'
               f'/{w}x{hh}@2x?attribution=false&logo=false&access_token={TOKEN}')
        img.paste(Image.open(io.BytesIO(get(url))).convert('RGB'), (0, top * 2))
    return img


def fit(pts, w, h, pad):
    """Zoom and centre so pts fill the box inside pad=(left, top, right, bottom)."""
    ws = [world(p) for p in pts]
    xs, ys = [p[0] for p in ws], [p[1] for p in ws]
    bw, bh = w - pad[0] - pad[2], h - pad[1] - pad[3]
    z = math.log2(min(bw / (max(xs) - min(xs)), bh / (max(ys) - min(ys))))
    mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    # the box centre sits off the image centre; move the map centre to compensate
    dx = (pad[0] + bw / 2 - w / 2) / 2 ** z
    dy = (pad[1] + bh / 2 - h / 2) / 2 ** z
    lon, lat = unworld(mx - dx, my - dy)
    return lon, lat, z


def svg_path(pts, lon, lat, z, w, h):
    cx, cy = world((lon, lat))
    s = 2 ** z
    xy = [((x - cx) * s + w / 2, (y - cy) * s + h / 2) for x, y in map(world, pts)]
    return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in xy), xy


def main():
    OUT.mkdir(exist_ok=True)
    pts = route()
    sectors = cut(pts, [1 / 3, 2 / 3])
    chunks = cut(pts, [i / 12 for i in range(1, 12)])
    data = {}
    flat = {
        # name: (w, h, padding left/top/right/bottom)
        'full': (390, 844, (48, 120, 48, 430)),   # route above a bottom sheet
        'card': (366, 250, (30, 30, 30, 30)),     # route inside a tile
    }
    for name, (w, h, pad) in flat.items():
        lon, lat, z = fit(pts, w, h, pad)
        entry = {'w': w, 'h': h}
        for i, s in enumerate(sectors):
            entry[f's{i + 1}'], _ = svg_path(s, lon, lat, z, w, h)
        for i, c in enumerate(chunks):
            entry[f'c{i}'], _ = svg_path(c, lon, lat, z, w, h)
        entry['all'], xy = svg_path(pts, lon, lat, z, w, h)
        entry['start'] = [round(v, 1) for v in xy[0]]
        entry['finish'] = [round(v, 1) for v in xy[-1]]
        data[name] = entry
        for style in ('dark-v11', 'light-v11'):
            static(style, lon, lat, z, w, h).save(OUT / f'{name}-{style[:-4]}.png', optimize=True)

    # Drive: pitched view behind the car, two thirds of the way up the climb, route drawn by Mapbox.
    car_d = 0.72
    driven, ahead = cut(pts, [car_d])
    a, b = driven[-3], driven[-1]
    bearing = round((math.degrees(math.atan2(b[0] - a[0], (b[1] - a[1]) / math.cos(math.radians(b[1])))) + 360) % 360)
    s1, s2, s3a = cut(driven, [0.4630, 0.9259])   # sector boundaries at 1/3 and 2/3 of the whole route
    near = lambda line: [p for p in line if hav(p, b) < 700] or line[-2:]
    # look slightly ahead so the car sits low on the screen
    look = cut(ahead, [0.06])[0][-1]
    # style: (ahead, sector 1, sector 2, current sector) colours
    for style, (c_ahead, c1, c2, c3) in {'dark-v11': ('#ffffff', '#a970ff', '#3be07a', '#ffffff'),
                                         'light-v11': ('#304352', '#7a3fd0', '#1f7a45', '#304352')}.items():
        feats = [
            {'type': 'Feature', 'properties': {'stroke': c, 'stroke-width': 8, 'stroke-opacity': o},
             'geometry': {'type': 'LineString', 'coordinates': [[round(x, 5), round(y, 5)] for x, y in near(line)]}}
            for line, c, o in ((ahead, c_ahead, .35), (s1, c1, 1), (s2, c2, 1), (s3a, c3, 1))
        ]
        gj = urllib.parse.quote(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')))
        img = Image.open(io.BytesIO(get(
            f'{API}/styles/v1/mapbox/{style}/static/geojson({gj})/{look[0]:.6f},{look[1]:.6f},16.2,{bearing},60'
            f'/390x640@2x?attribution=false&logo=false&access_token={TOKEN}'))).convert('RGB')
        img.save(OUT / f'drive-{style[:-4]}.png', optimize=True)

    (OUT / 'maps.json').write_text(json.dumps(data, indent=1))
    print('route', len(pts), 'points; wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
