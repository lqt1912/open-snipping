import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OverlayComponent } from './components/overlay/overlay.component';
import { EditorComponent } from './components/editor/editor.component';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

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

  private unlistenCropReady?: UnlistenFn;

  constructor(private zone: NgZone) {}

  async ngOnInit() {
    const win = getCurrentWindow();
    this.isOverlayWindow = win.label === 'overlay';

    if (this.isOverlayWindow) {
      this.mode = 'overlay';
      return;
    }

    // Use Tauri's official event system to receive crop-ready from Rust.
    // emit_to() / listen() is reliable cross-window: Tauri queues and delivers
    // the event once the window's JS runtime is ready.
    this.unlistenCropReady = await listen<string>('crop-ready', (event) => {
      const path = event.payload;
      console.log('[main] crop-ready received, path:', path);
      this.zone.run(() => {
        this.croppedImagePath = path;
        this.mode = 'editor';
      });
    });
  }

  ngOnDestroy() {
    this.unlistenCropReady?.();
  }

  async startCapture() {
    await invoke('show_overlay');
  }

  onEditorClosed() {
    this.croppedImagePath = null;
    this.mode = 'launcher';
  }
}
