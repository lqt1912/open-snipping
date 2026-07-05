from PIL import Image, ImageDraw

img = Image.open("/home/lqt1912/.gemini/antigravity-ide/brain/c8dd4e80-d6f3-4787-afaa-e386118bc444/snip_sketch_brown_icon_1783213765548.png").convert("RGBA")
width, height = img.size

# Create a rounded rectangle mask
mask = Image.new('L', (width, height), 0)
draw = ImageDraw.Draw(mask)
# radius for rounded corners
r = 150
draw.rounded_rectangle((0, 0, width, height), radius=r, fill=255)

# Apply mask
img.putalpha(mask)

img.save("src-tauri/icons/icon.png", "PNG")
