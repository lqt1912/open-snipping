use tauri::{Emitter, Manager, State};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use std::path::PathBuf;
use std::sync::Mutex;

mod capture;
mod image_processor;

// ── Shared state ───────────────────────────────────────────────────────────

/// Cached RGBA pixel data from the last crop — for instant clipboard copies.
pub struct ClipCache {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Pre-decoded full-screen RGB — populated while user draws selection.
pub struct ScreenCache {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub window_width: u32,
    pub window_height: u32,
}

pub struct AppState {
    pub clip_cache:      Mutex<Option<ClipCache>>,
    pub screen_cache:    Mutex<Option<ScreenCache>>,
    /// Currently registered global shortcut string (e.g. "Ctrl+Shift+S").
    pub current_hotkey:  Mutex<String>,
}

// ── Settings persistence ───────────────────────────────────────────────────

const DEFAULT_HOTKEY: &str = "Ctrl+Shift+S";

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join("settings.json")
}

fn load_hotkey(app: &tauri::AppHandle) -> String {
    let path = settings_path(app);
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(s) = v.get("hotkey").and_then(|x| x.as_str()) {
                return s.to_string();
            }
        }
    }
    DEFAULT_HOTKEY.to_string()
}

fn save_hotkey(app: &tauri::AppHandle, hotkey: &str) {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, serde_json::json!({ "hotkey": hotkey }).to_string());
}

// ── Capture trigger — shared by hotkey handler, tray menu, and show_overlay ─

fn trigger_capture(app: &tauri::AppHandle) {
    println!("[trigger_capture] Called!");
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.show();
        let _ = overlay.set_focus();
        let _ = overlay.emit("capture-start", ());
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        match tauri::async_runtime::spawn_blocking(capture::do_capture).await {
            Ok(Ok(path)) => {
                if let Err(e) = app2.emit_to("overlay", "capture-ready", &path) {
                    eprintln!("[trigger_capture] emit failed: {e}");
                }
            }
            Ok(Err(e)) => eprintln!("[trigger_capture] capture failed: {e}"),
            Err(e)     => eprintln!("[trigger_capture] join error: {e}"),
        }
    });
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Returns the currently registered hotkey string.
#[tauri::command]
fn get_hotkey(state: State<'_, AppState>) -> String {
    state.current_hotkey.lock().unwrap().clone()
}

/// Unregisters the old hotkey, registers the new one, and persists the setting.
#[tauri::command]
fn update_hotkey(
    app:   tauri::AppHandle,
    state: State<'_, AppState>,
    hotkey: String,
) -> Result<(), String> {
    // Unregister previous shortcut (best-effort; ignore errors if already gone)
    let old = state.current_hotkey.lock().unwrap().clone();
    let _ = app.global_shortcut().unregister(old.as_str());

    // Register new shortcut
    app.global_shortcut()
        .register(hotkey.as_str())
        .map_err(|e| format!("Cannot register '{}': {}", hotkey, e))?;

    *state.current_hotkey.lock().unwrap() = hotkey.clone();
    save_hotkey(&app, &hotkey);
    Ok(())
}

/// Show overlay and immediately return — screenshot runs in background.
/// The overlay appears instantly; the screenshot is taken after compositor settles.
#[tauri::command]
async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    trigger_capture(&app);
    Ok(())
}

/// Legacy path kept for safety — called by overlay after crop selection.
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

// ── App entry point ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            clip_cache:     Mutex::new(None),
            screen_cache:   Mutex::new(None),
            current_hotkey: Mutex::new(DEFAULT_HOTKEY.to_string()),
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Global shortcut plugin — handler fires for any registered shortcut
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        trigger_capture(app);
                    }
                })
                .build(),
        )
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
            hide_overlay,
            get_hotkey,
            update_hotkey,
        ])
        .setup(|app| {
            // ── Debug logging ──────────────────────────────────────────
            #[cfg(debug_assertions)]
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ── Load and register initial hotkey ───────────────────────
            let hotkey = load_hotkey(app.handle());
            *app.state::<AppState>().current_hotkey.lock().unwrap() = hotkey.clone();
            if let Err(e) = app.global_shortcut().register(hotkey.as_str()) {
                eprintln!("[setup] hotkey '{}' registration failed: {e}", hotkey);
                eprintln!("[setup] Is another instance running or is the key taken?");
            } else {
                println!("[setup] Hotkey '{}' registered successfully.", hotkey);
            }

            // ── System tray ────────────────────────────────────────────
            let capture_item = MenuItem::with_id(app, "capture", "New Capture",  true, None::<&str>)?;
            let show_item    = MenuItem::with_id(app, "show",    "Show Window",  true, None::<&str>)?;
            let sep          = PredefinedMenuItem::separator(app)?;
            let quit_item    = MenuItem::with_id(app, "quit",    "Quit",         true, None::<&str>)?;
            let tray_menu    = Menu::with_items(app, &[&capture_item, &show_item, &sep, &quit_item])?;

            TrayIconBuilder::with_id("open-snipping")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Open Snipping")
                .title("Open Snipping")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)   // left-click = show window; right-click = menu
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "capture" => trigger_capture(app),
                        "show"    => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            println!("[tray] Quit requested — exiting.");
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on tray icon → toggle main window visibility
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // ── Intercept main window close button → hide to tray ──────
            // Prevents the window from being destroyed; keeps the process alive.
            if let Some(main_win) = app.get_webview_window("main") {
                let win_for_close = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_for_close.hide();
                        println!("[main] Window closed → hidden to tray.");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
