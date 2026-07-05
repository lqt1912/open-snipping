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
        await this.win.show();
        await this.win.setFocus();
        await this.win.setSize(EDITOR_SIZE);
        await this.win.center();
      });
    });
  }

  ngOnDestroy() {
    this.unlistenCropReady?.();
  }

  async startCapture() {
    await invoke('trigger_capture_from_ui');
  }

  async onEditorClosed() {
    this.croppedImagePath = null;
    this.mode = 'launcher';
    await invoke('close_editor');
  }

  // ── Hotkey recording ─────────────────────────────────────────

  startRecording() {
    this.isRecording = true;
    this.hotkeyError = '';
  }

  cancelRecording() {
    this.isRecording = false;
  }

  private isMetaDown = false;

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
    if (event.key === 'Meta' || event.key === 'OS' || event.key === 'Super') {
      this.isMetaDown = false;
    }
  }

  @HostListener('window:keydown', ['$event'])
  async onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Meta' || event.key === 'OS' || event.key === 'Super') {
      this.isMetaDown = true;
    }

    if (event.key === 'Escape' && !this.isRecording) {
      if (this.mode === 'launcher') {
        await this.win.hide();
      }
      return;
    }

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
    if (event.metaKey || this.isMetaDown)  mods.push('Super');

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
        this.hotkeyError = `Lỗi: ${e}`;
      });
    }
  }

  requiresSuper(): boolean {
    return this.currentHotkey.includes('Super+');
  }

  async toggleSuper(event: any) {
    const checked = event.target.checked;
    let newHotkey = this.currentHotkey;
    
    if (checked && !newHotkey.includes('Super+')) {
      newHotkey = 'Super+' + newHotkey;
    } else if (!checked && newHotkey.includes('Super+')) {
      newHotkey = newHotkey.replace('Super+', '');
    }

    if (newHotkey === this.currentHotkey) return;

    try {
      await invoke('update_hotkey', { hotkey: newHotkey });
      this.zone.run(() => {
        this.currentHotkey = newHotkey;
        this.hotkeyError   = '';
      });
    } catch (e) {
      this.zone.run(() => {
        this.hotkeyError = `Lỗi: ${e}`;
      });
      // Revert checkbox state visually if failed
      event.target.checked = !checked;
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
