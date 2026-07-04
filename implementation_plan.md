# MỤC TIÊU DỰ ÁN (PROJECT OVERVIEW)
Bạn đóng vai trò là một Senior Full-Stack Software Engineer, chuyên gia về hệ sinh thái Rust, Tauri và Angular.
Nhiệm vụ của bạn là giúp tôi xây dựng `open-snipping` - một ứng dụng chụp màn hình mã nguồn mở trên Linux (tương tự Windows Snipping Tool).

# DANH SÁCH TÍNH NĂNG CỐT LÕI (CORE FEATURES)
1. **Silent Fullscreen Capture:** Tự động chụp toàn bộ màn hình hiện tại (tương thích cả X11 và Wayland) ngay khi được gọi và lưu tạm vào hệ thống.
2. **Smart Overlay Window:** Hiển thị cửa sổ không viền (frameless), nền trong suốt làm mờ nhẹ toàn bộ màn hình để tập trung vào việc chọn vùng ảnh.
3. **Select & Crop:** Cho phép người dùng click và kéo chuột (drag) để vẽ một khung chữ nhật, xác định chính xác toạ độ vùng ảnh cần cắt.
4. **Editor Canvas:** Cửa sổ độc lập hiển thị vùng ảnh đã cắt, tích hợp HTML5 `<canvas>` cung cấp các công cụ ghi chú nhanh (như bút vẽ, bút highlight đỏ).
5. **Quick Export & Copy:** Tích hợp nút sao chép ảnh trực tiếp vào Clipboard (để dán nhanh) và nút Lưu file (Save As) qua hộp thoại hệ thống.
6. **Global Hotkeys:** Đăng ký tổ hợp phím tắt (Ví dụ: `Ctrl+Shift+S`) để kích hoạt ngay chế độ chụp ảnh bất kể người dùng đang mở phần mềm nào.
7. **System Tray:** Ứng dụng có thể chạy ngầm dưới khay hệ thống, sẵn sàng hoạt động với mức tiêu thụ RAM tối thiểu.

# TECH STACK
- Backend/Core: Rust + Tauri (v2 nếu có thể, hoặc v1).
- Frontend: Angular (phiên bản mới nhất) + TypeScript.
- Build Tool: Node.js (npm/pnpm) & Cargo.
- DevOps/Môi trường: Docker, GitHub Actions.
- OS Target & Package: Linux (ưu tiên X11/Wayland), đóng gói tự động ra định dạng `.deb`.

# QUY TẮC PHÁT TRIỂN (CORE CONSTRAINTS & BEST PRACTICES)
Để đảm bảo dự án chuẩn Open-source, scalable và gọn nhẹ, bạn BẮT BUỘC phải tuân thủ các quy tắc sau khi sinh code:

1. **English-Only Codebase (BẮT BUỘC):** Toàn bộ mã nguồn (source code), bao gồm tên biến, comments, log messages, README và các đoạn text hiển thị trên UI BẮT BUỘC phải viết bằng Tiếng Anh (English) 100% để phù hợp với cộng đồng Open-source quốc tế.
2. **Clean Code & Modularity:**
   - Frontend (Angular): Chia nhỏ components. Sử dụng Services để quản lý state và gọi Tauri IPC. Không viết logic phức tạp trực tiếp vào Component.
   - Backend (Rust): Tách biệt logic hệ thống ra khỏi các hàm Tauri Commands. Tạo các module riêng biệt (ví dụ: `src/capture.rs`, `src/image_processor.rs`).
3. **IPC (Inter-Process Communication) tối ưu:**
   - Hạn chế gửi dữ liệu quá lớn qua lại giữa Rust và Angular. Ưu tiên lưu file ảnh vào thư mục temp và gửi file path, hoặc nén Base64 tối ưu.
4. **Linux Compatibility:**
   - Xử lý mượt mà môi trường Wayland và X11. Chuẩn bị sẵn fallback function để gọi shell command (`grim` cho Wayland, `scrot`/`xwd` cho X11) nếu thư viện native Rust lỗi.
5. **Trải nghiệm người dùng (UX):**
   - Cửa sổ Overlay phải cấu hình không viền (frameless), nền trong suốt (transparent) và luôn nổi trên cùng (always on top).
   - Tối ưu bộ nhớ: Ứng dụng chạy ngầm phải tiêu tốn cực ít RAM.
6. **Chuẩn Open-Source, Docker & Conventional Commits:**
   - Cấu trúc thư mục rõ ràng. Thiết lập đầy đủ README, LICENSE, CONTRIBUTING.
   - Cung cấp cấu hình Docker để chuẩn hoá môi trường build Tauri trên Linux.
   - Sử dụng chuẩn Conventional Commits (ví dụ: `feat:`, `fix:`, `chore:`). Cấu hình CI/CD GitHub Actions tự động build và xuất file `.deb` khi có một Release hoặc Tag mới được đẩy lên dựa trên commit.
7. **Antigravity Ultra Optimization (CRITICAL):**
   - **Data Format:** Strictly output internal data structures, temporary configuration logs, and inter-agent communication using the `.toon` (Token-Oriented Object Notation) format to minimize token usage. ONLY use Markdown for explicit human-facing files like `README.md` or `CONTRIBUTING.md`.
   - **Skill Injection:** Explicitly load and utilize the `Tauri`, `Rust`, `Angular`, and `Docker` skills for accurate context grounding.
   - **Context Window Management:** If Dynamic Subagents are spawned to handle parallel tasks (e.g., Backend vs Frontend), strictly command them to save their intermediate files into a dedicated `_agent_workspace/` directory. Do not load these files back into the main context unless explicitly requested.
   - **Hard Output Limit Evasion:** You are restricted by a 16,384 token output limit per turn. Under NO circumstances should you generate a response that gets cut off mid-sentence. If a phase requires extensive code generation, break it down further and pause. End your response with "Ready for the next part?" and wait for my explicit confirmation before continuing.
---

# LỘ TRÌNH THỰC THI (EXECUTION PLAN)
Chúng ta sẽ không viết toàn bộ app ngay lập tức. Hãy đọc kỹ 4 giai đoạn dưới đây. 
**Yêu cầu của tôi ngay bây giờ:** Hãy xác nhận bạn đã hiểu toàn bộ yêu cầu và kiến trúc. Sau đó, hãy bắt đầu triển khai **Giai đoạn 1** và hướng dẫn tôi các lệnh cần chạy. Chúng ta sẽ làm tuần tự từng giai đoạn.

### Giai đoạn 1: Khởi tạo Project, Cấu hình Open-source & Môi trường Build
- Cung cấp lệnh khởi tạo project Tauri + Angular TypeScript.
- Cung cấp file `Dockerfile` cấu hình đầy đủ môi trường Linux (Ubuntu/Debian) chứa sẵn các dependencies bắt buộc của Tauri (như `libwebkit2gtk-4.0-dev`, `libgtk-3-dev`...) để anh em clone về có thể build được ngay.
- Tạo cấu hình GitHub Actions (`.github/workflows/release.yml`) tự động chạy `tauri build` khi có một Tag dạng `v*.*.*` được push lên, và cấu hình để xuất ra file `.deb` làm release artifacts.
- Cung cấp nội dung Tiếng Anh mẫu cho `README.md`, `LICENSE` (MIT) và `CONTRIBUTING.md`. Hướng dẫn cách áp dụng Conventional Commits.
- Hướng dẫn cấu hình `tauri.conf.json` (multiple windows, frameless, transparent) và TailwindCSS.

### Giai đoạn 2: Cơ chế Overlay & Chụp toàn màn hình
- Cung cấp mã Rust (Tauri Command) để chụp toàn màn hình âm thầm và lưu vào file temp. Lưu ý cơ chế fallback cho Wayland/X11.
- Cung cấp mã Angular cho `OverlayComponent`: Hiển thị toàn màn hình, làm mờ nền, bắt sự kiện chuột (mousedown, mousemove, mouseup) để vẽ hộp chọn chữ nhật.
- Setup IPC để gửi toạ độ (x, y, w, h) từ Angular về lại Rust.

### Giai đoạn 3: Cắt ảnh (Crop) & Giao diện Editor
- Cung cấp mã Rust sử dụng thư viện `image` để nhận toạ độ, crop ảnh gốc và trả về kết quả (đường dẫn ảnh mới).
- Cung cấp mã Angular cho `EditorComponent`: Hiển thị ảnh đã cắt. Sử dụng HTML5 `<canvas>` để vẽ UI thêm các công cụ cơ bản.
- Triển khai chức năng "Copy to Clipboard" và "Save As".

### Giai đoạn 4: System Tray & Global Hotkeys
- Viết mã Rust để cấu hình ứng dụng chạy ngầm dưới System Tray với menu cơ bản (Capture, Exit).
- Đăng ký Global Hotkey (VD: `Ctrl+Shift+S`) bằng thư viện của Tauri để trigger hàm chụp ảnh và gọi cửa sổ Overlay lên.
