# Open Snipping

Open Snipping is a lightweight, open-source screenshot application for Linux, designed to provide a seamless experience similar to the Windows Snipping Tool. Built with Rust, Tauri, and Angular, it supports both X11 and Wayland environments.

## Core Features

- **Silent Fullscreen Capture:** Instantly captures the entire screen when triggered.
- **Smart Overlay Window:** Features a frameless, transparent overlay to focus on the selected area.
- **Select & Crop:** Click and drag to define the exact region you want to capture.
- **Editor Canvas:** An HTML5 `<canvas>` based editor for quick annotations (drawing, highlighting).
- **Quick Export & Copy:** Easily copy the snip to your clipboard or save it as an image file.
- **Global Hotkeys:** Quick access via customizable global hotkeys (e.g., `Ctrl+Shift+S`).
- **System Tray:** Runs silently in the background with minimal RAM usage.

## Installation

You can download the latest `.deb` package from our [Releases](https://github.com/yourusername/open-snipping/releases) page.

Alternatively, you can build from source:

```bash
# Clone the repository
git clone https://github.com/yourusername/open-snipping.git
cd open-snipping

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for release
npm run tauri build
```

## Linux Requirements

Make sure you have the required dependencies for Tauri on Linux installed:
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
