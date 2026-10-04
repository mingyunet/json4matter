#!/usr/bin/env python3
"""Generate json4matter PNG icons (mint background + white { } glyph). Pure stdlib."""
import struct
import zlib
import os

BG = (16, 185, 129)      # #10B981 mint
FG = (255, 255, 255)      # white

# 5x7 bitmap glyphs for { and }
GLYPH = {
    '{': [
        ".###.",
        "#....",
        "#....",
        ".###.",
        "#....",
        "#....",
        ".###.",
    ],
    '}': [
        ".###.",
        "....#",
        "....#",
        ".###.",
        "....#",
        "....#",
        ".###.",
    ],
}


def make_icon(size):
    radius = max(2, int(size * 0.20))
    pad = int(size * 0.14)
    avail = size - 2 * pad
    # layout: "{" (5 cols) + 1 gap col + "}" (5 cols) = 11 cols x 7 rows
    cell = max(1, int(avail / 8.0))
    gw, gh = 11 * cell, 7 * cell
    ox = (size - gw) // 2
    oy = (size - gh) // 2

    # build a function to test transparent corner (only within corner squares)
    def corner_transparent(x, y):
        r = radius - 0.5
        if x < radius and y < radius:
            return (x - r) ** 2 + (y - r) ** 2 > radius * radius
        if x >= size - radius and y < radius:
            return (x - (size - radius + 0.5)) ** 2 + (y - r) ** 2 > radius * radius
        if x < radius and y >= size - radius:
            return (x - r) ** 2 + (y - (size - radius + 0.5)) ** 2 > radius * radius
        if x >= size - radius and y >= size - radius:
            return (x - (size - radius + 0.5)) ** 2 + (y - (size - radius + 0.5)) ** 2 > radius * radius
        return False

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            if corner_transparent(x, y):
                raw += bytes((0, 0, 0, 0))
                continue
            # glyph test (two braces separated by a 1-cell gap)
            lx = (x - ox) // cell
            ly = (y - oy) // cell
            is_fg = False
            if 0 <= ly < 7:
                if 0 <= lx < 5:
                    is_fg = GLYPH['{'][ly][lx] == '#'
                elif 6 <= lx < 11:
                    is_fg = GLYPH['}'][ly][lx - 6] == '#'
            col = FG if is_fg else BG
            raw += bytes((col[0], col[1], col[2], 255))
    return raw


def png_chunk(tag, data):
    chunk = struct.pack('>I', len(data)) + tag + data
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    chunk += struct.pack('>I', crc)
    return chunk


def write_png(path, size):
    raw = make_icon(size)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    png = sig + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', idat) + png_chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 32, 48, 128):
        write_png(os.path.join(here, f'icon{s}.png'), s)
    print('icons generated:', os.listdir(here))
