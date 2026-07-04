use std::env;
use std::process::Command;

/// Inner blocking capture logic.
/// The 500ms sleep ensures the window compositor (Wayland/X11) has finished
/// hiding all app windows before grim takes the screenshot.
/// This runs in a background task so the user never feels the delay.
pub fn do_capture() -> Result<String, String> {
    let temp_dir = env::temp_dir();
    let temp_file = temp_dir.join("open-snipping-capture.png");
    let file_path = temp_file.to_string_lossy().to_string();

    let _ = std::fs::remove_file(&temp_file);

    // Wait for the compositor to process all pending window hide/show commands.
    // 500ms is conservative but safe for all Wayland compositors (KWin, Mutter, Sway).
    // Running in background → user doesn't feel this delay at all.
    std::thread::sleep(std::time::Duration::from_millis(500));

    let is_wayland = env::var("WAYLAND_DISPLAY").is_ok();

    if is_wayland {
        let status = Command::new("grim")
            .arg(&file_path)
            .status()
            .map_err(|e| format!("Failed to execute grim: {}", e))?;
        if !status.success() {
            return Err("grim failed. Make sure grim is installed.".to_string());
        }
    } else {
        let status = Command::new("scrot")
            .arg(&file_path)
            .args(["-z", "--quality", "90"])
            .status()
            .map_err(|e| format!("Failed to execute scrot: {}", e))?;
        if !status.success() {
            return Err("scrot failed. Make sure scrot is installed.".to_string());
        }
    }

    Ok(file_path)
}

/// Tauri command — kept for direct JS calls if needed.
#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(do_capture)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}
