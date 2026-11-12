# BackendCity — Terminal nhúng để chat tiếp một phiên

Ngày: 2026-11-12 · Trạng thái: chờ duyệt · Nối tiếp spec phần 1–4 (vẫn ràng buộc) · Nhánh `feat/part4`

## 1. Mục tiêu

Bấm nút trong panel của thị trưởng thì một **terminal thật** mở ngay trong trang BackendCity, chạy `claude --resume <id-phiên>` ở thư mục dự án. Người dùng chat tiếp phiên đó y như trong terminal: hỏi quyền, phím tắt, lệnh `/`, Esc để ngắt đều dùng được.

Thành công khi:
- Mở được một phiên đang Nghỉ, gõ và nhận trả lời trong khung.
- Đóng khung thì claude tắt.
- Mở lại thì `--resume` tiếp đúng cuộc trò chuyện.

## 2. Phạm vi

**Trong:**
- Server: kênh WebSocket `/pty` và bộ quản lý terminal ảo.
- Client: khung terminal, nút trong panel và hộp xác nhận.
- Thêm 3 thư viện (§6).
- Gỡ phần mở terminal ngoài bằng `--resume` vừa làm: route `POST /api/session/:id/resume` và trường `resume` của job trong `bin/claude-launch.mjs` và `LaunchOpts`.

**Ngoài:**
- Chạy tiếp khi đóng khung hoặc nối lại vào terminal đang chạy (đóng là tắt).
- Nhiều terminal trên một trang.
- Terminal cho nhân viên (subagent).
- Mở phiên mới bằng terminal nhúng (nút "+ Mở phiên" giữ nguyên, vẫn mở cửa sổ ngoài).
- Copy/paste nâng cao ngoài mặc định của xterm.
- Truy cập từ máy khác (server vẫn chỉ nghe 127.0.0.1).

## 3. Server

### 3.1 Bộ quản lý terminal — `src/server/pty.ts`

- `PtyHub`, nhận các phụ thuộc qua tham số:
  - `spawn` có cùng dạng với `node-pty` `spawn`, để test thay bằng bản giả;
  - đường dẫn `claude`;
  - `max = 3`.
- `open(sessionId, cwd, cols, rows)`:
  - trả về một terminal, hoặc `null` khi đã đủ 3 cái hoặc không có `claude`;
  - chạy file `claude` với tham số `["--resume", sessionId]`, không qua shell;
  - tuỳ chọn `name: "xterm-256color"`, `cwd`, `env: process.env`.
- Terminal trả về:
  - nhận dữ liệu qua `onData` và thoát qua `onExit`;
  - có `write`, `resize` và `kill`;
  - tự gỡ khỏi hub khi thoát.
- `killAll()` được gọi khi server tắt.
- Không gọi `kill` trên terminal đã thoát. Khi thử bằng tay, gọi `kill` sau lúc thoát làm `node-pty` ném lỗi `AttachConsole failed`.

### 3.2 Kênh `/pty`

Nâng cấp (upgrade) cùng HTTP server với `/ws`: `GET /pty?token=…&session=<id>&cols=<n>&rows=<n>`. Từ chối trước khi nâng cấp:

| Điều kiện | Trả về |
|---|---|
| token sai hoặc thiếu (so sánh an toàn thời gian như `tokenOk`) | 401 |
| Origin không thuộc `http://127.0.0.1:<port>` hoặc `http://localhost:<port>` | 403 |
| `session` không đúng dạng UUID `^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$` (không phân biệt hoa thường) hoặc server không theo dõi phiên đó | 404 |
| đã đủ 3 terminal hoặc không tìm thấy `claude` | 503 |

- `cols` mặc định 120 và giới hạn trong 20–400; `rows` mặc định 32 và giới hạn trong 5–200. Số không hợp lệ thì dùng mặc định.
- `cwd` là thư mục của phiên nếu còn tồn tại, không thì `homedir()`.
- Tin nhắn:
  - Server gửi về: khung text chứa nguyên văn đầu ra của terminal.
  - Client gửi lên: khung text JSON.
    - `{"t":"in","d":"<chuỗi>"}` thì ghi `d` vào terminal.
    - `{"t":"size","cols":n,"rows":n}` thì `resize` theo giới hạn ở trên.
    - Mọi thứ khác (JSON hỏng, sai kiểu, sai trường) bị bỏ qua, không đóng kết nối.
  - Mỗi tin nhắn tối đa 64 KB (`maxPayload` của `ws`).
- Kết thúc:
  - WebSocket đóng thì `kill` terminal, nếu nó còn chạy.
  - Terminal thoát thì server đóng WebSocket với mã `4000` và lý do là mã thoát dạng chuỗi.

## 4. Client

### 4.1 Khung terminal — `src/client/term.ts`

- `openTerminal(opts: { sessionId, title, token, onClose })` tạo một lớp phủ cố định:
  - hộp chiếm khoảng 80vw × 80vh, căn giữa, nền tối;
  - thanh tiêu đề gồm "Terminal — <tên dự án>" và nút ✕;
  - bên dưới là `@xterm/xterm` với `@xterm/addon-fit`.
- Mở xong thì gọi `fit()`, kết nối tới `/pty` với `cols` và `rows` sau khi fit, rồi đặt focus vào terminal.
- Phím bấm: `term.onData(d)` gửi `{t:"in",d}`. Khi khung đổi kích thước (sự kiện `resize` của cửa sổ), gọi `fit()` rồi gửi `{t:"size",…}`.
- Esc thuộc về claude:
  - sự kiện `keydown` bên trong khung không được lan ra `document`, để panel và scene không bắt Esc;
  - chỉ nút ✕ mới đóng khung.
- Đóng (bấm ✕) thì đóng WebSocket, huỷ xterm, gỡ lớp phủ và gọi `onClose`.
- WebSocket đóng với mã `4000` thì in thêm dòng `Phiên đã kết thúc (mã X)` và giữ khung mở.
- Kết nối bị từ chối hoặc đứt bất thường thì in `Không kết nối được terminal`.
- Mỗi trang chỉ có một khung tại một thời điểm.

### 4.2 Nút trong panel

- Panel của thị trưởng giữ nút "Mở phiên trong terminal", nhưng giờ nút mở khung nhúng thay vì gọi `POST …/resume`.
- Phiên có trạng thái `working` hoặc `waiting` thì trước khi mở hiện hộp xác nhận (dùng `showDialog` sẵn có):
  - nội dung: "Phiên này có thể đang mở ở chỗ khác (app desktop hoặc terminal). Mở thêm sẽ có hai nơi cùng ghi vào một cuộc trò chuyện.";
  - hai nút "Vẫn mở" và "Huỷ".
- Phiên `idle` thì mở luôn.
- Khi khung đang mở, nút bị khoá và hiện "Terminal đang mở".

## 5. An toàn

- Kênh `/pty` có cùng ba lớp bảo vệ với `/ws`:
  - server chỉ nghe 127.0.0.1;
  - phải có token;
  - Origin phải đúng.
- Thêm hai lớp:
  - id phải là UUID của một phiên server đang theo dõi;
  - tham số chạy claude là mảng cố định `["--resume", id]`, không có shell và không ghép chuỗi lệnh.
- Giới hạn 3 terminal cùng lúc và 64 KB mỗi tin nhắn.

## 6. Thư viện

- `node-pty` (dependency của server). Đã thử trên máy: Node 24.19, Windows x64, bản 1.1.0 kèm sẵn bản dựng `prebuilds/win32-x64`, chạy được `cmd` và `claude --version`. Script cài đặt chỉ kiểm tra bản dựng đó, nên npm chặn script vẫn không ảnh hưởng.
- `@xterm/xterm` và `@xterm/addon-fit` (chỉ cho client, được Vite gói vào bản build). CSS của xterm được import qua Vite.

## 7. Test

- **`test/pty.test.ts`** — `PtyHub` với `spawn` giả:
  - chạy đúng file và đúng tham số;
  - trả `null` khi đã đủ 3;
  - terminal thoát thì giải phóng chỗ;
  - `killAll` tắt hết;
  - không `kill` terminal đã thoát.
- **`test/http-pty.test.ts`** — kênh `/pty` trên server thật, dùng hub giả:
  - 401, 403, 404 (phiên lạ, id sai dạng) và 503 (đã đủ);
  - phím bấm tới được hub và đầu ra về được client;
  - `size` bị kẹp theo giới hạn, tin nhắn hỏng bị bỏ qua;
  - đóng WebSocket thì `kill`;
  - terminal thoát thì kết nối đóng với mã 4000.
- **`test/panel.test.ts`**:
  - phiên `working` hiện hộp xác nhận, "Huỷ" thì không mở, "Vẫn mở" thì mở;
  - phiên `idle` mở luôn;
  - đang mở thì nút bị khoá.
- Gỡ các test của route `/resume` và trường `resume` trong job.
- **Kiểm tra bằng tay trên trình duyệt:**
  - mở một phiên đang Nghỉ, gõ `/help`, Esc không đóng khung;
  - đóng khung thì tiến trình claude biến mất;
  - mở lại thì thấy cuộc trò chuyện cũ.
