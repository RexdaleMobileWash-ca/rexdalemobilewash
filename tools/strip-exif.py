#!/usr/bin/env python3
"""Strip EXIF/XMP metadata from staged images, without re-encoding them.

Gate 5 requires this: client photos routinely carry the GPS coordinates of a
home. On this site 15 files carried one coordinate ~130km from the business
address.

Re-saving through an image library would re-compress and change every pixel. This
works at the container level instead — JPEG APP1 segments and PNG eXIf/iTXt/tEXt
chunks are metadata wrappers around untouched compressed image data, so dropping
them is lossless. verify_pixels() proves that.

    python3 tools/strip-exif.py <directory>
"""
import os, sys, glob, struct

def strip_jpeg(data: bytes) -> bytes:
    if not data.startswith(b'\xff\xd8'):
        return data
    out, i = bytearray(data[:2]), 2
    n = len(data)
    while i < n - 1:
        if data[i] != 0xFF:
            out += data[i:]
            break
        marker = data[i + 1]
        # start of scan: the rest is entropy-coded image data, copy verbatim
        if marker == 0xDA:
            out += data[i:]
            break
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            out += data[i:i + 2]; i += 2; continue
        if i + 4 > n:
            out += data[i:]; break
        seglen = struct.unpack('>H', data[i + 2:i + 4])[0]
        seg = data[i:i + 2 + seglen]
        payload = data[i + 4:i + 2 + seglen]
        drop = (marker == 0xE1 and (payload.startswith(b'Exif\x00\x00')
                                    or payload.startswith(b'http://ns.adobe.com/xap/')))
        if not drop:
            out += seg
        i += 2 + seglen
    return bytes(out)

def strip_png(data: bytes) -> bytes:
    sig = b'\x89PNG\r\n\x1a\n'
    if not data.startswith(sig):
        return data
    out, i = bytearray(sig), len(sig)
    n = len(data)
    while i + 8 <= n:
        length = struct.unpack('>I', data[i:i + 4])[0]
        ctype = data[i + 4:i + 8]
        chunk = data[i:i + 12 + length]
        if ctype not in (b'eXIf', b'iTXt', b'tEXt', b'zTXt'):
            out += chunk
        i += 12 + length
        if ctype == b'IEND':
            break
    return bytes(out)

def verify_pixels(before: bytes, after: bytes) -> bool:
    """Decoded pixels must be identical — this is what makes the strip lossless."""
    from PIL import Image
    import io
    a = Image.open(io.BytesIO(before)); b = Image.open(io.BytesIO(after))
    if a.size != b.size or a.mode != b.mode:
        return False
    return a.tobytes() == b.tobytes()

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.port-work/b2-staging'
    changed = saved = checked = 0
    failed = []
    for f in sorted(glob.glob(os.path.join(root, '**', '*'), recursive=True)):
        if not os.path.isfile(f):
            continue
        ext = os.path.splitext(f)[1].lower()
        data = open(f, 'rb').read()
        if ext in ('.jpg', '.jpeg'):
            new = strip_jpeg(data)
        elif ext == '.png':
            new = strip_png(data)
        else:
            continue
        if new == data:
            continue
        if not verify_pixels(data, new):
            failed.append(f)
            continue
        checked += 1
        open(f, 'wb').write(new)
        changed += 1
        saved += len(data) - len(new)
    print(f"  files rewritten        : {changed}")
    print(f"  pixel-identical after  : {checked} of {changed}")
    print(f"  metadata bytes removed : {saved}")
    if failed:
        print(f"  LEFT ALONE (pixels would have changed): {len(failed)}")
        for f in failed[:10]:
            print("     ", f)
    return 1 if failed else 0

if __name__ == '__main__':
    sys.exit(main())
