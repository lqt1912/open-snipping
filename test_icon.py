from PIL import Image

def test():
    img = Image.open("src-tauri/icons/32x32.png").convert("RGBA")
    pixels = img.load()
    print("32x32 Color at 0,0:", pixels[0, 0])
    
test()
