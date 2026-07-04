import {
  Component, HostListener, OnInit, OnDestroy, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './overlay.component.html',
  styleUrls: ['./overlay.component.css']
})
export class OverlayComponent implements OnInit, OnDestroy {
  isSelecting = false;
  isCapturing = true;  // true until 'capture-ready' fires
  startX = 0;
  startY = 0;
  selection: Selection | null = null;

  private imagePath: string | null = null;
  private unlistenFocus?: UnlistenFn;
  private unlistenCapture?: UnlistenFn;

  constructor(private zone: NgZone) {}

  async ngOnInit() {
    const win = getCurrentWindow();

    // Reset state each time a new capture is triggered.
    // show_overlay() in Rust emits this immediately before taking the screenshot.
    this.unlistenFocus = await listen('capture-start', () => {
      this.zone.run(() => {
        this.imagePath = null;
        this.isSelecting = false;
        this.selection = null;
        this.isCapturing = true;  // wait for capture-ready
      });
    });

    // Rust emits 'capture-ready' after grim finishes (500ms after show_overlay).
    // This is the only trigger that enables user interaction.
    this.unlistenCapture = await listen<string>('capture-ready', (event) => {
      const path = event.payload;
      this.zone.run(() => {
        this.imagePath = path;
        this.isCapturing = false;
        console.log('[overlay] Capture ready:', path);
      });

      // Pre-decode PNG in background while user draws selection.
      // By the time mouseUp fires, ScreenCache is populated and crop is instant.
      invoke('pre_decode_screenshot', {
        path,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      }).catch(err => console.warn('[overlay] pre-decode failed:', err));
    });
  }

  ngOnDestroy() {
    this.unlistenFocus?.();
    this.unlistenCapture?.();
  }

  onMouseDown(event: MouseEvent) {
    if (this.isCapturing) return;
    this.isSelecting = true;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.selection = { x: this.startX, y: this.startY, width: 0, height: 0 };
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isSelecting || !this.selection) return;
    const cx = event.clientX;
    const cy = event.clientY;
    this.selection.x = Math.min(this.startX, cx);
    this.selection.y = Math.min(this.startY, cy);
    this.selection.width = Math.abs(cx - this.startX);
    this.selection.height = Math.abs(cy - this.startY);
  }

  async onMouseUp() {
    this.isSelecting = false;
    if (!this.selection || this.selection.width <= 0 || this.selection.height <= 0) return;

    const sel = { ...this.selection };
    this.selection = null;

    if (!this.imagePath) {
      console.error('[overlay] No imagePath on mouseup');
      await invoke('hide_overlay');
      return;
    }

    // Send CSS pixel coordinates + window size.
    // Rust computes scale = screenshot_px / window_css — no devicePixelRatio needed.
    const cssX = Math.round(sel.x);
    const cssY = Math.round(sel.y);
    const cssW = Math.round(sel.width);
    const cssH = Math.round(sel.height);
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    console.log(`[overlay] crop CSS: ${cssX},${cssY} ${cssW}x${cssH}  win: ${windowWidth}x${windowHeight}`);

    try {
      await invoke('crop_and_finish', {
        path: this.imagePath,
        x: cssX, y: cssY, width: cssW, height: cssH,
        windowWidth, windowHeight,
      });
    } catch (e) {
      console.error('[overlay] Crop failed:', e);
      alert('Crop error: ' + e);
    }
  }

  @HostListener('window:keydown.escape', ['$event'])
  async onEscapeKey(event: KeyboardEvent) {
    event.preventDefault();
    this.isSelecting = false;
    this.selection = null;
    await invoke('hide_overlay');
  }

  @HostListener('contextmenu', ['$event'])
  async onRightClick(event: MouseEvent) {
    event.preventDefault();
    this.isSelecting = false;
    this.selection = null;
    await invoke('hide_overlay');
  }
}
