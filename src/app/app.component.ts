import { Component, OnInit, OnDestroy, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OverlayComponent } from './components/overlay/overlay.component';
import { EditorComponent } from './components/editor/editor.component';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

const LAUNCHER_SIZE = new LogicalSize(360, 200);
const EDITOR_SIZE   = new LogicalSize(1280, 800);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, OverlayComponent, EditorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  mode: 'launcher' | 'overlay' | 'editor' = 'launcher';
  croppedImagePath: string | null = null;
  isOverlayWindow = false;

  // ── Hotkey state ────────────────────────────────────────────
  currentHotkey   = 'Ctrl+Shift+S';
  isRecording     = false;
  hotkeyError     = '';

  private unlistenCropReady?: UnlistenFn;
  private win = getCurrentWindow();

  constructor(private zone: NgZone) {}

  async ngOnInit() {
    this.isOverlayWindow = this.win.label === 'overlay';

    if (this.isOverlayWindow) {
      this.mode = 'overlay';
      return;
    }

    // Load persisted hotkey from Rust
    try {
      this.currentHotkey = await invoke<string>('get_hotkey');
    } catch { /* keep default */ }

    this.unlistenCropReady = await listen<string>('crop-ready', (event) => {
      const path = event.payload;
      this.zone.run(async () => {
        this.croppedImagePath = path;
        this.mode = 'editor';
        await this.win.setResizable(true);
        await this.win.setSize(EDITOR_SIZE);
        await this.win.center();
      });
    });
  }

  ngOnDestroy() {
    this.unlistenCropReady?.();
  }

  async startCapture() {
    await invoke('show_overlay');
  }

  async onEditorClosed() {
    this.croppedImagePath = null;
    this.mode = 'launcher';
    await this.win.setResizable(false);
    await this.win.setSize(LAUNCHER_SIZE);
    await this.win.center();
  }

  // ── Hotkey recording ─────────────────────────────────────────

  startRecording() {
    this.isRecording = true;
    this.hotkeyError = '';
  }

  cancelRecording() {
    this.isRecording = false;
  }

  @HostListener('window:keydown', ['$event'])
  async onKeyDown(event: KeyboardEvent) {
    if (!this.isRecording) return;
    event.preventDefault();
    event.stopPropagation();

    // Escape = cancel
    if (event.key === 'Escape') {
      this.isRecording = false;
      return;
    }

    // Collect modifiers
    const mods: string[] = [];
    if (event.ctrlKey)  mods.push('Ctrl');
    if (event.altKey)   mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (event.metaKey)  mods.push('Super');

    // Ignore bare modifier key presses — wait for the actual key
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    // Require at least one modifier to prevent accidentally overriding letters
    if (mods.length === 0) {
      this.hotkeyError = 'Use at least one modifier (Ctrl, Alt, Shift)';
      return;
    }

    // Normalize key name
    const key = this.normalizeKey(event.key);
    const hotkey = [...mods, key].join('+');

    this.isRecording = false;

    try {
      await invoke('update_hotkey', { hotkey });
      this.zone.run(() => {
        this.currentHotkey = hotkey;
        this.hotkeyError   = '';
      });
    } catch (e) {
      this.zone.run(() => {
        this.hotkeyError = `Could not register "${hotkey}" — key may be taken by another app.`;
      });
    }
  }

  /** Normalize browser `KeyboardEvent.key` to a Tauri-compatible token. */
  private normalizeKey(key: string): string {
    if (key.length === 1) return key.toUpperCase();
    const map: Record<string, string> = {
      ' ':           'Space',
      'ArrowUp':     'Up',
      'ArrowDown':   'Down',
      'ArrowLeft':   'Left',
      'ArrowRight':  'Right',
      'Enter':       'Return',
      'Backspace':   'BackSpace',
      'Delete':      'Delete',
      'Home':        'Home',
      'End':         'End',
      'PageUp':      'PageUp',
      'PageDown':    'PageDown',
      'Insert':      'Insert',
      'Tab':         'Tab',
    };
    return map[key] ?? key;  // F1-F12 already have the right format
  }
}
