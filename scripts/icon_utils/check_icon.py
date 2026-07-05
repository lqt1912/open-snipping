from PIL import Image

img = Image.open("src-tauri/icons/128x128.png").convert("RGBA")
pixels = img.load()
width, height = img.size

non_transparent_count = 0
for y in range(height):
    for x in range(width):
        r, g, b, a = pixels[x, y]
        if a > 0:
            non_transparent_count += 1

print(f"Non-transparent pixels: {non_transparent_count} out of {width*height}")
