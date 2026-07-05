from PIL import Image

img = Image.open("src-tauri/icons/128x128.png").convert("RGBA")
pixels = img.load()
width, height = img.size

center_pixel = pixels[width//2, height//2]
print(f"Center pixel: {center_pixel}")
