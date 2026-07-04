<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Open Snipping Logo" width="128" />
  <h1>Open Snipping</h1>
  <p>A fast, lightweight, and keyboard-friendly screenshot tool for Linux, built with Tauri and Angular.</p>

  <p>
    <a href="https://github.com/lqt1912/open-snipping/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/lqt1912/open-snipping?style=flat-square&color=blue" /></a>
    <a href="https://github.com/lqt1912/open-snipping/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/lqt1912/open-snipping?style=flat-square&v=1" /></a>
    <a href="https://github.com/lqt1912/open-snipping/actions"><img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/lqt1912/open-snipping/release.yml?style=flat-square" /></a>
  </p>
</div>

---

**Open Snipping** is designed to provide a seamless screenshot experience similar to the Windows Snipping Tool but natively tailored for Linux (supporting both **X11** and **Wayland** environments). It lives in your system tray, uses minimal RAM, and is instantly accessible via a global hotkey.

## ✨ Features

- 📸 **Silent Fullscreen Capture:** Instantly captures the entire screen when triggered.
- 🎯 **Smart Overlay Window:** Features a frameless, transparent overlay to focus on the selected area.
- ✂️ **Select & Crop:** Click and drag to define the exact region you want to capture.
- 🎨 **Editor Canvas:** An HTML5 `<canvas>` based editor for quick annotations (drawing, highlighting, arrows).
- 📋 **Quick Export & Copy:** Instantly copy the snip to your clipboard or save it as an image file.
- ⌨️ **Global Hotkeys:** Quick access via customizable global hotkeys (Default: `Ctrl+Shift+D`).
- 🚀 **System Tray:** Runs silently in the background with minimal footprint.

## 📥 Installation

The easiest way to install Open Snipping is to grab the pre-built `.deb` or `.AppImage` package from the [Releases](https://github.com/lqt1912/open-snipping/releases) page.

### Dependencies
Open Snipping relies on the following lightweight utilities for screen capturing:
- **X11:** `scrot`
- **Wayland:** `grim`

If they are not installed, the app will prompt you or fail to capture. You can install them via your package manager:
```bash
sudo apt-get install scrot grim
```

## 🛠️ Building from Source

If you prefer to build the app yourself, ensure you have **Node.js** and **Rust** installed, along with the Linux prerequisites for Tauri.

### 1. Install System Dependencies (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### 2. Clone and Build
```bash
# Clone the repository
git clone https://github.com/lqt1912/open-snipping.git
cd open-snipping

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build the release packages (.deb and .AppImage)
npm run tauri build
```
The generated packages will be available in `src-tauri/target/release/bundle/`.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check the [issues page](https://github.com/lqt1912/open-snipping/issues) if you want to contribute.

## 📝 License

This project is licensed under the [MIT License](LICENSE).
