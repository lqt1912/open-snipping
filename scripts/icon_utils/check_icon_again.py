from PIL import Image

try:
    img = Image.open("src-tauri/icons/128x128.png").convert("RGBA")
    pixels = img.load()
    width, height = img.size

    center_pixel = pixels[width//2, height//2]
    top_left = pixels[0, 0]
    print(f"Center pixel: {center_pixel}")
    print(f"Top left pixel: {top_left}")
    
    solid = sum(1 for y in range(height) for x in range(width) if pixels[x, y][3] > 0)
    print(f"Non-transparent pixels: {solid} out of {width*height}")
except Exception as e:
    print(f"Error: {e}")
