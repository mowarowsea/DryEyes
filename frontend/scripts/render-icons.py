# public/favicon.svg と同じ図形を描いて、PNG のアイコン一式を書き出す。
#   python scripts/render-icons.py public
# SVG を触ったときは、ここの制御点も同じ値に合わせること（SVG が原本）。
# 依存は Pillow のみ。ラスタライザを別途入れずに済ませるためにこの形にしている。
from PIL import Image, ImageDraw

S = 2048                 # 作業解像度（512 の 4 倍でスーパーサンプリング）
K = S / 512.0            # SVG 座標 -> 作業座標

def p(x, y): return (x * K, y * K)

def bez(p0, p1, p2, p3, n=120):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0]
        y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
        out.append((x, y))
    return out

# favicon.svg の目の輪郭（同じ制御点）
LENS = (
    bez((88,256), (156,132), (214,112), (256,112)) +
    bez((256,112), (298,112), (356,132), (424,256))[1:] +
    bez((424,256), (356,340), (298,360), (256,360))[1:] +
    bez((256,360), (214,360), (156,340), (88,256))[1:]
)
LENS_PX = [p(x, y) for x, y in LENS]

WHITE = (255, 255, 255, 255)
IRIS = (67, 56, 202, 255)          # #4338ca

def lens_mask():
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    d.polygon(LENS_PX, fill=255)
    r = 13 * K                      # stroke-width 26 / 2（角を丸める分）
    for x, y in LENS_PX:
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    return m

def circle(d, cx, cy, rr, fill):
    x, y = p(cx, cy); r = rr * K
    d.ellipse((x - r, y - r, x + r, y + r), fill=fill)

def eye_layer():
    mask = lens_mask()
    eye = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    eye.paste(Image.new('RGBA', (S, S), WHITE), (0, 0), mask)

    iris = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    circle(ImageDraw.Draw(iris), 238, 240, 94, IRIS)
    iris.putalpha(Image.composite(iris.getchannel('A'), Image.new('L', (S, S), 0), mask))
    eye.alpha_composite(iris)

    gl = ImageDraw.Draw(eye)
    circle(gl, 212, 210, 30, WHITE)
    circle(gl, 266, 270, 13, (255, 255, 255, 128))
    # SVG の rotate(-6) は反時計回り 6 度
    return eye.rotate(6, resample=Image.BICUBIC, center=p(256, 240))

def gradient():
    # #6366f1 -> #4338ca の斜めグラデーション
    g = Image.new('RGB', (128, 128))
    px = g.load()
    a, b = (99, 102, 241), (67, 56, 202)
    for y in range(128):
        for x in range(128):
            t = (x + y) / 254.0
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return g.resize((S, S), Image.BICUBIC).convert('RGBA')

def background(rounded):
    bg = gradient()
    if not rounded:
        return bg
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=112 * K, fill=255)
    bg.putalpha(m)
    return bg

def compose(rounded=True, art_scale=1.0):
    img = background(rounded)
    eye = eye_layer()
    if art_scale != 1.0:
        w = round(S * art_scale)
        small = eye.resize((w, w), Image.LANCZOS)
        eye = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        eye.paste(small, ((S - w) // 2, (S - w) // 2), small)
    img.alpha_composite(eye)
    return img

def save(img, path, size):
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(path, size)

import sys
out = sys.argv[1].rstrip('/')
any_icon = compose()
save(any_icon, f'{out}/icons/icon-512.png', 512)
save(any_icon, f'{out}/icons/icon-192.png', 192)
save(any_icon, f'{out}/favicon-32.png', 32)
save(compose(rounded=False), f'{out}/icons/apple-touch-icon.png', 180)
save(compose(rounded=False, art_scale=0.76), f'{out}/icons/icon-maskable-512.png', 512)
