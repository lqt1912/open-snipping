import os
from PIL import Image

def process_image(path):
    try:
        img = Image.open(path).convert("RGBA")
        width, height = img.size
        pixels = img.load()
        changed = False
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                # If it's a corner area (very simple heuristic: if it's near the edge and has low alpha or is white)
                # Actually, let's just make all white-ish pixels with high brightness transparent if they are on the edges.
                # Better: make any pixel with alpha < 255 transparent.
                if a < 255:
                    pixels[x, y] = (0, 0, 0, 0)
                    changed = True
        if changed:
            img.save(path, "PNG")
            print(f"Fixed {path}")
    except Exception as e:
        pass

for f in os.listdir("src-tauri/icons"):
    if f.endswith(".png"):
        process_image(os.path.join("src-tauri/icons", f))

