from PIL import Image
img = Image.open("src-tauri/icons/32x32.png").convert("RGBA")
pixels = img.load()
width, height = img.size
solid = 0
for y in range(height):
    for x in range(width):
        if pixels[x, y][3] == 255:
            solid += 1
print(f"Solid pixels in 32x32: {solid} out of {width*height}")
