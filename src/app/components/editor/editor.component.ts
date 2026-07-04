import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  HostListener,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrawTool = 'pen' | 'highlight' | 'rectangle' | 'arrow' | 'text' | 'none';

interface Point { x: number; y: number; }

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#a855f7', '#ffffff', '#000000',
];

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5.0;
const ZOOM_STEP = 0.1;
/** Max undo steps retained per session. */
const MAX_UNDO_STEPS = 100;

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.css'],
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  // ── Canvas refs ─────────────────────────────────────────────────────────────
  @ViewChild('imageCanvas') private imageCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas')  private drawCanvasRef!:  ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasViewport') private viewportRef!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput')   private textInputRef?:   ElementRef<HTMLInputElement>;

  // ── Image input ─────────────────────────────────────────────────────────────
  private _imagePath = '';
  /** Blob URL created from readFile — always same-origin, never taints canvas. */
  private imageBlobUrl: string | null = null;

  @Input()
  set imagePath(value: string) {
    this._imagePath = value;
    this.isCopying = false;
    this.isSaving  = false;
    this.copySuccess = false;
    this.undoHistory = [];
    this.showTextInput = false;
    this.isDrawing = false;
    this.isPanning = false;
    if (value) setTimeout(() => this.loadImageToCanvas(value), 0);
  }
  get imagePath(): string { return this._imagePath; }

  @Output() closed     = new EventEmitter<void>();
  @Output() newCapture = new EventEmitter<void>();

  // ── UI state ────────────────────────────────────────────────────────────────
  isCopying    = false;
  isSaving     = false;
  copySuccess  = false;

  // ── Drawing state ───────────────────────────────────────────────────────────
  activeTool: DrawTool = 'pen';
  strokeColor  = '#ef4444';
  strokeWidth  = 3;
  readonly presetColors = PRESET_COLORS;

  private isDrawing = false;
  private startPoint: Point = { x: 0, y: 0 };
  private lastPoint:  Point = { x: 0, y: 0 };
  private currentStrokePoints: Point[] = [];
  private snapshotBeforeStroke: ImageData | null = null;
  private undoHistory: ImageData[] = [];

  // ── Text tool state ─────────────────────────────────────────────────────────
  showTextInput       = false;
  textInputValue      = '';
  textInputScreenPos  = { x: 0, y: 0 };
  private textCanvasPos: Point = { x: 0, y: 0 };

  // ── Pan state ───────────────────────────────────────────────────────────────
  isPanning = false;
  private panStartX       = 0;
  private panStartY       = 0;
  private panScrollStartX = 0;
  private panScrollStartY = 0;

  // ── Ctrl-pan state ──────────────────────────────────────────────────────────
  /** True while the Ctrl key is physically held down. */
  ctrlHeld = false;

  // ── Clipboard debounce timer ──────────────────────────────────────────────
  private clipboardSyncTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Zoom state ──────────────────────────────────────────────────────────────
  zoom = 1.0;
  private naturalWidth  = 0;
  private naturalHeight = 0;

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    if (this._imagePath) this.loadImageToCanvas(this._imagePath);
  }

  ngOnDestroy(): void {
    if (this.imageBlobUrl) URL.revokeObjectURL(this.imageBlobUrl);
    clearTimeout(this.clipboardSyncTimer);
  }

  // ── Computed ─────────────────────────────────────────────────────────────────
  get canvasDisplayWidth():  number  { return this.naturalWidth  * this.zoom; }
  get canvasDisplayHeight(): number  { return this.naturalHeight * this.zoom; }
  get zoomPercent():         string  { return Math.round(this.zoom * 100) + '%'; }
  get canUndo():             boolean { return this.undoHistory.length > 0; }

  get cursorClass(): string {
    if (this.isPanning)              return 'cursor-grabbing';
    // Ctrl held → temporary pan mode regardless of active drawing tool
    if (this.ctrlHeld)               return 'cursor-grab';
    if (this.activeTool === 'none')  return 'cursor-grab';
    if (this.activeTool === 'text')  return 'cursor-text-tool';
    return 'cursor-crosshair-tool';
  }

  // ── Image loading ─────────────────────────────────────────────────────────
  /**
   * Load image via readFile → Blob URL so the canvas is NEVER tainted.
   * Using convertFileSrc(asset://) causes a cross-origin taint that makes
   * canvas.toBlob() throw SecurityError. Blob URLs are always same-origin.
   */
  private async loadImageToCanvas(path: string): Promise<void> {
    try {
      if (this.imageBlobUrl) {
        URL.revokeObjectURL(this.imageBlobUrl);
        this.imageBlobUrl = null;
      }

      const bytes    = await readFile(path);
      const mimeType = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      const blob     = new Blob([bytes], { type: mimeType });
      const blobUrl  = URL.createObjectURL(blob);
      this.imageBlobUrl = blobUrl;

      const img = new Image();
      img.onload = () => {
        this.zone.run(() => {
          this.naturalWidth  = img.naturalWidth;
          this.naturalHeight = img.naturalHeight;

          const imageCanvas = this.imageCanvasRef?.nativeElement;
          const drawCanvas  = this.drawCanvasRef?.nativeElement;
          if (!imageCanvas || !drawCanvas) return;

          imageCanvas.width  = img.naturalWidth;
          imageCanvas.height = img.naturalHeight;
          drawCanvas.width   = img.naturalWidth;
          drawCanvas.height  = img.naturalHeight;

          imageCanvas.getContext('2d')!.drawImage(img, 0, 0);
          drawCanvas.getContext('2d')!.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

          this.undoHistory = [];

          setTimeout(() => {
            this.fitToViewport();
            // Auto-sync clipboard right after load — user can paste immediately
            this.syncClipboardInBackground();
          }, 50);
        });
      };
      img.onerror = () => console.error('[Editor] Failed to load blob URL');
      img.src = blobUrl;
    } catch (e) {
      console.error('[Editor] loadImageToCanvas error:', e);
    }
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  fitToViewport(): void {
    const vp = this.viewportRef?.nativeElement;
    if (!vp || !this.naturalWidth || !this.naturalHeight) return;
    const scaleX = (vp.clientWidth  - 48) / this.naturalWidth;
    const scaleY = (vp.clientHeight - 48) / this.naturalHeight;
    this.zoom = Math.min(scaleX, scaleY, 1.0);
  }

  zoomIn():    void { this.zoom = Math.min(ZOOM_MAX, +(this.zoom + ZOOM_STEP).toFixed(2)); }
  zoomOut():   void { this.zoom = Math.max(ZOOM_MIN, +(this.zoom - ZOOM_STEP).toFixed(2)); }
  resetZoom(): void { this.zoom = 1.0; }

  onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.deltaY < 0 ? this.zoomIn() : this.zoomOut();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.showTextInput) { this.cancelText(); return; }
    if (event.ctrlKey && event.key === 'z' && !this.showTextInput) {
      event.preventDefault();
      this.undo();
      return;
    }
    // Track Ctrl key for temporary pan mode (Ctrl + drag)
    if (event.key === 'Control' && !event.repeat) {
      this.ctrlHeld = true;
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Control') {
      this.ctrlHeld = false;
      // If user was panning via Ctrl, release pan so draw tool resumes
      if (this.isPanning) this.isPanning = false;
    }
  }

  /** Reset Ctrl state if window loses focus (e.g. Alt+Tab while Ctrl held). */
  @HostListener('window:blur')
  onWindowBlur(): void {
    this.ctrlHeld = false;
    this.isPanning = false;
  }

  // ── Pan — global listeners so drag works even outside canvas bounds ────────
  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent): void {
    if (!this.isPanning) return;
    const vp = this.viewportRef?.nativeElement;
    if (!vp) return;
    vp.scrollLeft = this.panScrollStartX + (this.panStartX - event.clientX);
    vp.scrollTop  = this.panScrollStartY + (this.panStartY - event.clientY);
  }

  @HostListener('window:mouseup')
  onWindowMouseUp(): void {
    if (this.isPanning) this.isPanning = false;
  }

  // ── Canvas coordinate mapping ─────────────────────────────────────────────
  private getCanvasPoint(event: MouseEvent): Point {
    const rect = this.drawCanvasRef.nativeElement.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left)  / this.zoom,
      y: (event.clientY - rect.top)   / this.zoom,
    };
  }

  // ── Drawing event handlers ─────────────────────────────────────────────────
  onCanvasMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (this.isPanning) return; // already panning — guard against duplicate events
    event.preventDefault();

    // ── Pan mode: 'none' tool OR Ctrl held (temporary pan over any tool) ──
    if (this.activeTool === 'none' || this.ctrlHeld) {
      this.isPanning       = true;
      this.panStartX       = event.clientX;
      this.panStartY       = event.clientY;
      const vp             = this.viewportRef?.nativeElement;
      this.panScrollStartX = vp?.scrollLeft ?? 0;
      this.panScrollStartY = vp?.scrollTop  ?? 0;
      return;
    }

    const point = this.getCanvasPoint(event);

    // ── Text tool ──
    if (this.activeTool === 'text') {
      this.openTextInput(event, point);
      return;
    }

    // ── Drawing tools ──
    this.isDrawing = true;
    this.startPoint = { ...point };
    this.lastPoint  = { ...point };
    this.currentStrokePoints = [{ ...point }];

    const drawCanvas = this.drawCanvasRef.nativeElement;
    const dCtx = drawCanvas.getContext('2d')!;
    this.snapshotBeforeStroke = dCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);

    // Paint initial dot for pen/highlight
    if (this.activeTool === 'pen' || this.activeTool === 'highlight') {
      const r = this.activeTool === 'highlight' ? this.strokeWidth * 3 : this.strokeWidth / 2;
      dCtx.save();
      dCtx.globalAlpha = this.activeTool === 'highlight' ? 0.4 : 1.0;
      dCtx.fillStyle   = this.strokeColor;
      dCtx.beginPath();
      dCtx.arc(point.x, point.y, Math.max(r, 0.5), 0, Math.PI * 2);
      dCtx.fill();
      dCtx.restore();
    }
  }

  onCanvasMouseMove(event: MouseEvent): void {
    if (!this.isDrawing) return;
    event.preventDefault();

    const point = this.getCanvasPoint(event);
    const dCtx  = this.drawCanvasRef.nativeElement.getContext('2d')!;

    this.currentStrokePoints.push({ ...point });

    switch (this.activeTool) {
      case 'pen':
        // Restore + redraw smooth path (same as highlight) so Bézier can
        // see ALL accumulated points, not just the latest segment.
        dCtx.putImageData(this.snapshotBeforeStroke!, 0, 0);
        this.drawSmoothStroke(dCtx, this.currentStrokePoints, false);
        break;
      case 'highlight':
        // Restore + redraw entire path so alpha stays uniform
        dCtx.putImageData(this.snapshotBeforeStroke!, 0, 0);
        this.drawSmoothStroke(dCtx, this.currentStrokePoints, true);
        break;
      case 'rectangle':
      case 'arrow':
        dCtx.putImageData(this.snapshotBeforeStroke!, 0, 0);
        this.drawShape(dCtx, this.startPoint, point);
        break;
    }

    this.lastPoint = { ...point };
  }

  onCanvasMouseUp(event: MouseEvent): void {
    if (!this.isDrawing) return;
    event.preventDefault();

    const point = this.getCanvasPoint(event);
    const dc    = this.drawCanvasRef.nativeElement;
    const dCtx  = dc.getContext('2d')!;

    if (this.activeTool === 'rectangle' || this.activeTool === 'arrow') {
      dCtx.putImageData(this.snapshotBeforeStroke!, 0, 0);
      this.drawShape(dCtx, this.startPoint, point);
    }

    if (this.snapshotBeforeStroke) this.pushUndo(this.snapshotBeforeStroke);
    this.snapshotBeforeStroke  = null;
    this.isDrawing             = false;
    this.currentStrokePoints   = [];

    // Auto-sync clipboard — user can Ctrl+V immediately after each stroke
    this.syncClipboardInBackground();
  }

  onCanvasMouseLeave(event: MouseEvent): void {
    if (this.isDrawing) this.onCanvasMouseUp(event);
  }

  // ── Drawing primitives ────────────────────────────────────────────────────
  /**
   * Smooth freehand stroke using Quadratic Bézier curves through midpoints.
   *
   * Algorithm (standard "smooth brush" used by Excalidraw / Figma):
   *   For points P0…Pn, compute midpoints M_i = (P_i + P_{i+1}) / 2.
   *   Draw: moveTo(P0) → quadraticCurveTo(P_i, M_i) for each pair → lineTo(Pn)
   *
   * This ensures the curve passes through every captured point while the
   * midpoints act as smooth on/off ramps, eliminating the jagged corners
   * that appear when fast mouse movement produces widely-spaced samples.
   *
   * @param highlight  true → wide semi-transparent highlight mode
   */
  private drawSmoothStroke(
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    highlight: boolean,
  ): void {
    if (pts.length === 0) return;

    ctx.save();
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = this.strokeColor;
    ctx.fillStyle   = this.strokeColor;

    if (highlight) {
      ctx.lineWidth                = this.strokeWidth * 6;
      ctx.globalAlpha              = 0.4;
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.lineWidth   = this.strokeWidth;
      ctx.globalAlpha = 1.0;
    }

    // Single-point case: draw a dot
    if (pts.length === 1) {
      const r = highlight ? this.strokeWidth * 3 : this.strokeWidth / 2;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (pts.length === 2) {
      // Only two points — straight segment is already perfectly smooth
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      // Quadratic Bézier through midpoints
      for (let i = 0; i < pts.length - 2; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        // pts[i] is the control point; midpoint is the end anchor
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      // Final segment: control = second-to-last, anchor = last
      ctx.quadraticCurveTo(
        pts[pts.length - 2].x, pts[pts.length - 2].y,
        pts[pts.length - 1].x, pts[pts.length - 1].y,
      );
    }

    ctx.stroke();
    ctx.restore();
  }

  private drawShape(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    ctx.save();
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth   = this.strokeWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = 1.0;

    if (this.activeTool === 'rectangle') {
      ctx.strokeRect(
        Math.min(from.x, to.x), Math.min(from.y, to.y),
        Math.abs(to.x - from.x), Math.abs(to.y - from.y),
      );
    } else if (this.activeTool === 'arrow') {
      this.drawArrow(ctx, from, to);
    }

    ctx.restore();
  }

  private drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.sqrt(dx * dx + dy * dy) < 2) return;

    const headLen = Math.max(16, this.strokeWidth * 5);
    const angle   = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  // ── Text tool ────────────────────────────────────────────────────────────
  private openTextInput(event: MouseEvent, canvasPoint: Point): void {
    this.textCanvasPos       = canvasPoint;
    this.textInputScreenPos  = { x: event.clientX, y: event.clientY };
    this.textInputValue      = '';
    this.showTextInput       = true;
    setTimeout(() => this.textInputRef?.nativeElement?.focus(), 0);
  }

  confirmText(): void {
    if (!this.textInputValue.trim()) { this.showTextInput = false; return; }

    const dc   = this.drawCanvasRef.nativeElement;
    const dCtx = dc.getContext('2d')!;
    this.pushUndo(dCtx.getImageData(0, 0, dc.width, dc.height));

    dCtx.save();
    dCtx.font        = `bold ${Math.max(14, this.strokeWidth * 5)}px sans-serif`;
    dCtx.fillStyle   = this.strokeColor;
    dCtx.globalAlpha = 1.0;
    dCtx.fillText(this.textInputValue, this.textCanvasPos.x, this.textCanvasPos.y);
    dCtx.restore();

    this.showTextInput  = false;
    this.textInputValue = '';
    this.syncClipboardInBackground();
  }

  cancelText(): void {
    this.showTextInput  = false;
    this.textInputValue = '';
  }

  // ── Undo / Clear ─────────────────────────────────────────────────────────
  private pushUndo(snapshot: ImageData): void {
    this.undoHistory.push(snapshot);
    if (this.undoHistory.length > MAX_UNDO_STEPS) this.undoHistory.shift();
  }

  undo(): void {
    if (!this.undoHistory.length) return;
    const dc = this.drawCanvasRef.nativeElement;
    dc.getContext('2d')!.putImageData(this.undoHistory.pop()!, 0, 0);
    this.syncClipboardInBackground();
  }

  clearAll(): void {
    const dc   = this.drawCanvasRef.nativeElement;
    const dCtx = dc.getContext('2d')!;
    this.pushUndo(dCtx.getImageData(0, 0, dc.width, dc.height));
    dCtx.clearRect(0, 0, dc.width, dc.height);
    this.syncClipboardInBackground();
  }

  setTool(tool: DrawTool): void {
    this.activeTool = tool;
    if (this.showTextInput) this.cancelText();
  }

  setColor(color: string): void { this.strokeColor = color; }

  // ── Canvas merge helpers ─────────────────────────────────────────────────
  private getMergedCanvas(): HTMLCanvasElement {
    const ic = this.imageCanvasRef.nativeElement;
    const dc = this.drawCanvasRef.nativeElement;
    const mc = document.createElement('canvas');
    mc.width  = ic.width;
    mc.height = ic.height;
    const ctx = mc.getContext('2d')!;
    ctx.drawImage(ic, 0, 0);
    ctx.drawImage(dc, 0, 0);
    return mc;
  }

  /** Lossless PNG — used only for SaveAs to preserve quality. */
  private getMergedBlobPng(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.getMergedCanvas().toBlob(
        b => b ? resolve(b) : reject(new Error('toBlob returned null')),
        'image/png',
      );
    });
  }

  /**
   * JPEG blob for clipboard operations.
   * Encoding JPEG is 5-10× faster than PNG and the quality loss at 0.92
   * is imperceptible for screenshot annotations.
   */
  private getMergedBlobJpeg(quality = 0.92): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.getMergedCanvas().toBlob(
        b => b ? resolve(b) : reject(new Error('toBlob returned null')),
        'image/jpeg',
        quality,
      );
    });
  }

  /** Write PNG temp file for SaveAs (lossless). */
  private async getMergedTempPath(): Promise<string> {
    const blob  = await this.getMergedBlobPng();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path  = `/tmp/open-snipping-export-${Date.now()}.png`;
    await writeFile(path, bytes);
    return path;
  }

  // ── Auto clipboard sync ──────────────────────────────────────────────────
  /**
   * Debounced background sync — 300 ms after last stroke finishes.
   * Uses JPEG (fast encode) and caches the written temp-file path so the
   * manual Copy button can reuse it without re-encoding.
   */
  private lastSyncedPath: string | null = null;
  private lastSyncedAt   = 0;

  private syncClipboardInBackground(): void {
    clearTimeout(this.clipboardSyncTimer);
    this.clipboardSyncTimer = setTimeout(() => this.doClipboardSync(), 300);
  }

  private async doClipboardSync(): Promise<void> {
    if (!this.imageCanvasRef?.nativeElement || this.naturalWidth === 0) return;
    try {
      await invoke<void>('clear_clip_cache');
      // JPEG: fast encode, small file, imperceptible quality loss for clipboard
      const blob  = await this.getMergedBlobJpeg();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path  = `/tmp/open-snipping-clip-${Date.now()}.jpg`;
      await writeFile(path, bytes);
      await invoke<void>('copy_image_to_clipboard', { path });
      // Cache so Copy button can skip re-encoding when state hasn't changed
      this.lastSyncedPath = path;
      this.lastSyncedAt   = Date.now();
    } catch (e) {
      console.warn('[Editor] background clipboard sync failed:', e);
    }
  }

  // ── Manual Copy button ───────────────────────────────────────────────────
  async copyToClipboard(): Promise<void> {
    if (this.isCopying) return;
    this.isCopying   = true;
    this.copySuccess = false;
    try {
      // Fast-path: if background sync already wrote a fresh file (<2 s ago),
      // just re-invoke copy_image_to_clipboard — zero re-encoding cost.
      const now = Date.now();
      if (this.lastSyncedPath && (now - this.lastSyncedAt) < 2000) {
        await invoke<void>('clear_clip_cache');
        await invoke<void>('copy_image_to_clipboard', { path: this.lastSyncedPath });
      } else {
        // Slow-path: encode JPEG → write → Rust.
        // Still 5-10× faster than old PNG path; no dead navigator.clipboard attempt.
        await invoke<void>('clear_clip_cache');
        const blob  = await this.getMergedBlobJpeg();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const path  = `/tmp/open-snipping-clip-${Date.now()}.jpg`;
        await writeFile(path, bytes);
        await invoke<void>('copy_image_to_clipboard', { path });
        this.lastSyncedPath = path;
        this.lastSyncedAt   = now;
      }
      this.copySuccess = true;
      setTimeout(() => (this.copySuccess = false), 2000);
    } catch (e) {
      console.error('[Editor] copy failed:', e);
      alert('Failed to copy: ' + e);
    } finally {
      this.isCopying = false;
    }
  }

  // ── Save As ──────────────────────────────────────────────────────────────
  async saveAs(): Promise<void> {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const uid  = crypto.randomUUID().replace(/-/g, '').slice(0, 8);

      const destPath = await save({
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
        defaultPath: `screenshot_${date}_${time}_${uid}.png`,
      });
      if (destPath) {
        const srcPath = await this.getMergedTempPath();
        await invoke('save_image', { srcPath, destPath });
      }
    } catch (e) {
      console.error('[Editor] save failed:', e);
      alert('Failed to save: ' + e);
    } finally {
      this.isSaving = false;
    }
  }

  newCaptureRequest(): void { this.newCapture.emit(); }
  closeEditor():       void { this.closed.emit(); }
}
