use image::ImageReader;
use std::env;
use std::io::BufWriter;
use std::fs::File;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::State;
use crate::{AppState, ClipCache, ScreenCache};

const JPEG_QUALITY: u8 = 85;

/// Invalidate the in-memory RGBA clipboard cache.
/// The editor calls this before writing an annotated PNG so that the next
/// copy_image_to_clipboard reads from the new file instead of the stale
/// raw-crop bytes that crop_and_finish wrote during capture.
#[tauri::command]
pub fn clear_clip_cache(state: State<'_, AppState>) -> Result<(), String> {
    let mut cache = state.clip_cache.lock().map_err(|e| e.to_string())?;
    *cache = None;
    Ok(())
}


/// Monotonic counter — unique temp filename per capture to prevent Angular/browser cache no-ops.
static CAPTURE_ID: AtomicU32 = AtomicU32::new(0);

fn temp_cropped_path() -> String {
    let id = CAPTURE_ID.fetch_add(1, Ordering::Relaxed);
    env::temp_dir()
        .join(format!("open-snipping-crop-{}.jpg", id))
        .to_string_lossy()
        .to_string()
}

/// Convert CSS pixel selection to physical pixel coordinates.
/// scale = screenshot_physical_px / overlay_window_css_px.
/// Avoids window.devicePixelRatio which is unreliable on Wayland/HiDPI.
fn css_to_phys(
    css_x: u32, css_y: u32, css_w: u32, css_h: u32,
    img_w: u32, img_h: u32,
    win_w: u32, win_h: u32,
) -> (u32, u32, u32, u32) {
    let sx = img_w as f64 / win_w as f64;
    let sy = img_h as f64 / win_h as f64;
    let phys_x = ((css_x as f64 * sx).round() as u32).min(img_w.saturating_sub(1));
    let phys_y = ((css_y as f64 * sy).round() as u32).min(img_h.saturating_sub(1));
    let phys_w = ((css_w as f64 * sx).round() as u32).min(img_w - phys_x).max(1);
    let phys_h = ((css_h as f64 * sy).round() as u32).min(img_h - phys_y).max(1);
    (phys_x, phys_y, phys_w, phys_h)
}

fn save_rgb_as_jpeg(rgb: &image::RgbImage, out_path: &str) -> Result<(), String> {
    let file = File::create(out_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
    encoder
        .encode_image(&image::DynamicImage::ImageRgb8(rgb.clone()))
        .map_err(|e| format!("Failed to encode JPEG: {}", e))
}

/// Convert RgbImage to raw RGBA bytes (alpha=255).
fn rgb_to_rgba(rgb: &image::RgbImage) -> Vec<u8> {
    let mut rgba = Vec::with_capacity((rgb.width() * rgb.height() * 4) as usize);
    for p in rgb.pixels() {
        rgba.extend_from_slice(&[p[0], p[1], p[2], 255u8]);
    }
    rgba
}

/// Crop from pre-decoded raw RGB bytes — no file I/O, no decode.
fn crop_from_raw_rgb(
    cache: &ScreenCache,
    px: u32, py: u32, pw: u32, ph: u32,
) -> Result<image::RgbImage, String> {
    let full_w = cache.width;
    let mut out = Vec::with_capacity((pw * ph * 3) as usize);
    for row in py..py + ph {
        let row_start = ((row * full_w + px) * 3) as usize;
        let row_end = row_start + (pw * 3) as usize;
        out.extend_from_slice(&cache.rgb[row_start..row_end]);
    }
    image::RgbImage::from_raw(pw, ph, out)
        .ok_or_else(|| "Failed to build cropped image from cache".to_string())
}

/// Pre-decode the full PNG screenshot into ScreenCache while user draws selection.
/// Fire-and-forget from JS — when crop_and_finish runs, decode is already done.
#[tauri::command]
pub async fn pre_decode_screenshot(
    path: String,
    window_width: u32,
    window_height: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (raw, img_w, img_h) = tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<u8>, u32, u32), String> {
        let img = ImageReader::open(&path)
            .map_err(|e| format!("Failed to open: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode: {}", e))?;
        let rgb = img.into_rgb8();
        let (w, h) = rgb.dimensions();
        Ok((rgb.into_raw(), w, h))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let mut cache = state.screen_cache.lock().map_err(|e| e.to_string())?;
    *cache = Some(ScreenCache { rgb: raw, width: img_w, height: img_h, window_width, window_height });
    Ok(())
}

/// One-shot crop pipeline:
///   1. Hide overlay + show main (instant)
///   2. Crop (cache hit: slice bytes; miss: decode PNG)
///   3. Save JPEG
///   4. Emit 'crop-ready' IMMEDIATELY ← main latency win
///   5. Write clipboard in background ← doesn't block UI update
#[tauri::command]
pub async fn crop_and_finish(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    x: u32, y: u32, width: u32, height: u32,
    window_width: u32, window_height: u32,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri::Manager;

    // 1. Window management — instant.
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1280.0, height: 800.0 }));
        let _ = main.center();
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }

    // 2. Take pre-decoded screen from cache.
    let screen = {
        let mut lock = state.screen_cache.lock().map_err(|e| e.to_string())?;
        lock.take()
    };

    let out = temp_cropped_path();
    let out2 = out.clone();

    // 3. Crop + encode JPEG. Returns RGBA bytes for clipboard (computed in blocking thread).
    let (rgba, w, h) = if let Some(screen) = screen {
        let win_w = screen.window_width;
        let win_h = screen.window_height;
        let img_w = screen.width;
        let img_h = screen.height;

        tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<u8>, u32, u32), String> {
            let (px, py, pw, ph) = css_to_phys(x, y, width, height, img_w, img_h, win_w, win_h);
            println!("[crop] cache hit  scale=({:.3}x{:.3}) phys={}x{}", img_w as f64 / win_w as f64, img_h as f64 / win_h as f64, pw, ph);
            let rgb = crop_from_raw_rgb(&screen, px, py, pw, ph)?;
            save_rgb_as_jpeg(&rgb, &out2)?;
            let rgba = rgb_to_rgba(&rgb);
            Ok((rgba, pw, ph))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??
    } else {
        tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<u8>, u32, u32), String> {
            let img = ImageReader::open(&path)
                .map_err(|e| format!("Failed to open: {}", e))?
                .decode()
                .map_err(|e| format!("Failed to decode: {}", e))?;
            let (img_w, img_h) = (img.width(), img.height());
            let (px, py, pw, ph) = css_to_phys(x, y, width, height, img_w, img_h, window_width, window_height);
            println!("[crop] cache miss scale=({:.3}x{:.3}) phys={}x{}", img_w as f64 / window_width as f64, img_h as f64 / window_height as f64, pw, ph);
            let rgb = img.crop_imm(px, py, pw, ph).into_rgb8();
            save_rgb_as_jpeg(&rgb, &out2)?;
            let rgba = rgb_to_rgba(&rgb);
            Ok((rgba, pw, ph))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??
    };

    // 4. Store in ClipCache for on-demand copy button.
    {
        let mut cache = state.clip_cache.lock().map_err(|e| e.to_string())?;
        *cache = Some(ClipCache { rgba: rgba.clone(), width: w, height: h });
    }

    // 5. EMIT CROP-READY NOW — editor shows up while clipboard write runs in background.
    //    This is the key latency win: user sees the image ~100-500ms sooner.
    app.emit_to("main", "crop-ready", out)
        .map_err(|e| e.to_string())?;

    // 6. Clipboard write in background — non-blocking, user doesn't wait for it.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        let clip_img = tauri::image::Image::new_owned(rgba, w, h);
        if let Err(e) = app2.clipboard().write_image(&clip_img) {
            eprintln!("[crop] clipboard write failed: {}", e);
        }
    });

    Ok(())
}

/// Standalone crop.
#[tauri::command]
pub async fn crop_image(
    path: String, x: u32, y: u32, width: u32, height: u32,
    window_width: u32, window_height: u32,
) -> Result<String, String> {
    let out = temp_cropped_path();
    let out2 = out.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let img = ImageReader::open(&path)
            .map_err(|e| format!("Failed to open: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode: {}", e))?;
        let (img_w, img_h) = (img.width(), img.height());
        let (px, py, pw, ph) = css_to_phys(x, y, width, height, img_w, img_h, window_width, window_height);
        let rgb = img.crop_imm(px, py, pw, ph).into_rgb8();
        save_rgb_as_jpeg(&rgb, &out2)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    Ok(out)
}

/// Save image to user-chosen path.
/// Output format is determined by the `dest_path` extension:
///   - `.png` → lossless PNG
///   - anything else → JPEG at JPEG_QUALITY
#[tauri::command]
pub async fn save_image(src_path: String, dest_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let img = ImageReader::open(&src_path)
            .map_err(|e| format!("Failed to open: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode: {}", e))?;

        let ext = std::path::Path::new(&dest_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let file = File::create(&dest_path)
            .map_err(|e| format!("Failed to create file: {}", e))?;
        let mut writer = BufWriter::new(file);

        if ext == "png" {
            img.write_to(&mut writer, image::ImageFormat::Png)
                .map_err(|e| format!("Failed to encode PNG: {}", e))
        } else {
            let rgb = img.into_rgb8();
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
            encoder
                .encode_image(&image::DynamicImage::ImageRgb8(rgb))
                .map_err(|e| format!("Failed to encode JPEG: {}", e))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Copy to clipboard — fast path from ClipCache, fallback decodes file.
#[tauri::command]
pub async fn copy_image_to_clipboard(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let cached = {
        let lock = state.clip_cache.lock().map_err(|e| e.to_string())?;
        lock.as_ref().map(|c| (c.rgba.clone(), c.width, c.height))
    };

    if let Some((rgba, w, h)) = cached {
        let clip_img = tauri::image::Image::new_owned(rgba, w, h);
        app.clipboard().write_image(&clip_img)
            .map_err(|e| format!("Clipboard write failed: {}", e))?;
        return Ok(());
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let img = ImageReader::open(&path)
            .map_err(|e| format!("Failed to open image: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?;
        let rgb = img.into_rgb8();
        let rgba = rgb_to_rgba(&rgb);
        let (w, h) = rgb.dimensions();
        let clip_img = tauri::image::Image::new_owned(rgba, w, h);
        app.clipboard().write_image(&clip_img)
            .map_err(|e| format!("Clipboard write failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
