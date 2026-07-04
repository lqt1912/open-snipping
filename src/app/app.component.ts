import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
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

  private unlistenCropReady?: UnlistenFn;
  private win = getCurrentWindow();

  constructor(private zone: NgZone) {}

  async ngOnInit() {
    this.isOverlayWindow = this.win.label === 'overlay';

    if (this.isOverlayWindow) {
      this.mode = 'overlay';
      return;
    }

    this.unlistenCropReady = await listen<string>('crop-ready', (event) => {
      const path = event.payload;
      console.log('[main] crop-ready received, path:', path);
      this.zone.run(async () => {
        this.croppedImagePath = path;
        this.mode = 'editor';
        // Expand to editor size, allow resize, re-center
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
    // Shrink back and lock size for launcher
    await this.win.setResizable(false);
    await this.win.setSize(LAUNCHER_SIZE);
    await this.win.center();
  }
}
