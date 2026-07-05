from PIL import Image

def fix_icon(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    pixels = img.load()
    
    def flood_fill(start_x, start_y):
        target_color = pixels[start_x, start_y]
        if target_color[0] < 200 or target_color[1] < 200 or target_color[2] < 200:
            return
            
        queue = [(start_x, start_y)]
        visited = set()
        
        while queue:
            x, y = queue.pop(0)
            if (x, y) in visited:
                continue
            visited.add((x, y))
            
            if x < 0 or x >= width or y < 0 or y >= height:
                continue
                
            r, g, b, a = pixels[x, y]
            
            if r > 200 and g > 200 and b > 200 and a > 0:
                pixels[x, y] = (255, 255, 255, 0)
                queue.append((x + 1, y))
                queue.append((x - 1, y))
                queue.append((x, y + 1))
                queue.append((x, y - 1))

    flood_fill(0, 0)
    flood_fill(width - 1, 0)
    flood_fill(0, height - 1)
    flood_fill(width - 1, height - 1)
    
    img.save(output_path, "PNG")

fix_icon("src-tauri/icons/icon.png", "src-tauri/icons/icon.png")
