use tauri::{Emitter, Manager, State};
mod capture;
mod image_processor;

use std::sync::Mutex;

/// Cached RGBA pixel data from the last crop — for instant clipboard copies.
pub struct ClipCache {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Pre-decoded full-screen RGB — populated in background while user draws selection.
/// Stores window CSS dimensions so Rust can compute scale = screenshot_px / window_css.
pub struct ScreenCache {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub window_width: u32,
    pub window_height: u32,
}

pub struct AppState {
    pub clip_cache: Mutex<Option<ClipCache>>,
    pub screen_cache: Mutex<Option<ScreenCache>>,
}

/// Show overlay and immediately return — screenshot runs in background.
/// This makes the overlay appear instantly with no blocking wait on the JS side.
/// The screenshot is taken after a 500ms sleep (compositor settle time) and
/// delivered to the overlay via 'capture-ready' event.
#[tauri::command]
async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Hide main window and show overlay immediately.
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.show().map_err(|e| e.to_string())?;
        overlay.set_focus().map_err(|e| e.to_string())?;
    }

    // Run screenshot in background — user doesn't wait for it, overlay appears instantly.
    // do_capture() internally sleeps 500ms so the compositor has time to hide windows.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        match tauri::async_runtime::spawn_blocking(capture::do_capture).await {
            Ok(Ok(path)) => {
                // Deliver screenshot path to the overlay — it will enable selection.
                if let Err(e) = app2.emit_to("overlay", "capture-ready", &path) {
                    eprintln!("[show_overlay] Failed to emit capture-ready: {}", e);
                }
            }
            Ok(Err(e)) => eprintln!("[show_overlay] capture failed: {}", e),
            Err(e) => eprintln!("[show_overlay] task join error: {}", e),
        }
    });

    Ok(())
}

/// Legacy path kept for safety.
#[tauri::command]
async fn finish_capture(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    app.emit_to("main", "crop-ready", path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            clip_cache: Mutex::new(None),
            screen_cache: Mutex::new(None),
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            capture::capture_screen,
            image_processor::pre_decode_screenshot,
            image_processor::crop_image,
            image_processor::crop_and_finish,
            image_processor::save_image,
            image_processor::copy_image_to_clipboard,
            image_processor::clear_clip_cache,
            show_overlay,
            finish_capture,
            hide_overlay
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
