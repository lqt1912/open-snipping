import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.css']
})
export class EditorComponent {
  // Use a setter so imageSrc updates whenever imagePath changes —
  // this fixes the "second capture not showing" bug where ngOnInit
  // only runs once and never re-fires on input changes.
  private _imagePath!: string;

  @Input()
  set imagePath(value: string) {
    this._imagePath = value;
    this.imageSrc = value ? convertFileSrc(value) : null;
    // Reset state for the new image
    this.isCopying = false;
    this.isSaving = false;
    this.copySuccess = false;
  }
  get imagePath(): string { return this._imagePath; }

  @Output() closed = new EventEmitter<void>();
  @Output() newCapture = new EventEmitter<void>();

  imageSrc: string | null = null;
  isCopying = false;
  isSaving = false;
  copySuccess = false;

  async copyToClipboard() {
    if (this.isCopying) return;
    this.isCopying = true;
    this.copySuccess = false;
    try {
      await invoke('copy_image_to_clipboard', { path: this.imagePath });
      this.copySuccess = true;
      setTimeout(() => (this.copySuccess = false), 2000);
    } catch (e) {
      console.error('Failed to copy to clipboard', e);
      alert('Failed to copy: ' + e);
    } finally {
      this.isCopying = false;
    }
  }

  async saveAs() {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      // Generate unique default filename: screenshot_YYYYMMDD_HHMMSS_<short-uuid>.jpg
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const shortUuid = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      const defaultName = `screenshot_${datePart}_${timePart}_${shortUuid}.jpg`;

      const savePath = await save({
        filters: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }],
        defaultPath: defaultName
      });
      if (savePath) {
        await invoke('save_image', {
          srcPath: this.imagePath,
          destPath: savePath,
        });
      }
    } catch (e) {
      console.error('Failed to save file', e);
      alert('Failed to save: ' + e);
    } finally {
      this.isSaving = false;
    }
  }

  newCaptureRequest() {
    this.newCapture.emit();
  }

  closeEditor() {
    this.closed.emit();
  }
}
