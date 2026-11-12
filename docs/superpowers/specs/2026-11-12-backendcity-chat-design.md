# BackendCity — Khung chat kiểu Claude Desktop

Ngày: 2026-11-12 · Trạng thái: chờ duyệt · Nối tiếp spec terminal nhúng (vẫn ràng buộc) · Nhánh `feat/chat`

## 1. Mục tiêu

Panel của thị trưởng có thêm nút **"Chat"**. Bấm vào thì mở một khung chat giống Claude Desktop để chat tiếp phiên đó.
- Bong bóng tin nhắn, có markdown và khối code.
- Mỗi tool call là một dòng gập lại được.
- Khi claude xin quyền, hiện thẻ có hai nút **Cho phép / Từ chối**.
- Ô gõ nằm ở dưới.

Terminal nhúng vẫn giữ nguyên, ở nút "Terminal".

Thành công khi:
- Mở chat với một phiên đang Nghỉ thì thấy các lượt gần đây.
- Gửi tin nhắn thì thấy claude trả lời từng chữ một.
- Khi claude xin chạy lệnh thì hiện thẻ; bấm Cho phép thì lệnh chạy, bấm Từ chối thì claude được báo là bị từ chối.
- Bấm Dừng thì ngắt lượt đang chạy.
- Đóng khung thì claude tắt. Mở lại thì vẫn đúng cuộc trò chuyện đó.

## 2. Phạm vi

**Trong:**
- Server: bộ quản lý `ChatHub`, kênh WebSocket `/chat`, đọc lịch sử từ transcript.
- Client: khung chat, nút "Chat" trong panel.
- Thêm thư viện `marked` phía client (§6).

**Ngoài:**
- Lệnh `/` và phím tắt của claude: đã có nút Terminal.
- Đính kèm file hoặc ảnh, đổi model hay chế độ quyền trong khung.
- Nhiều khung chat trên một trang, hoặc mở chat và terminal cùng lúc.
- Chạy tiếp khi đóng khung, nối lại vào claude đang chạy.
- Chat cho nhân viên (subagent). Mở phiên mới bằng chat.

## 3. Server

### 3.1 Bộ quản lý chat — `src/server/chat.ts`

`ChatHub` nhận các phụ thuộc qua tham số giống `PtyHub`:
- `spawn`: cùng dạng với `child_process.spawn`, để test thay bằng bản giả;
- đường dẫn `claude`;
- `max = 3`.

**`open(sessionId, cwd)`** trả về một phiên chat. Trả về `null` khi đã đủ 3 phiên hoặc không có `claude`.

Tham số chạy là mảng cố định, không qua shell:

`["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--resume", sessionId, "--permission-prompts", "host"]`

Đi kèm `cwd`, `env: process.env`, `stdio: pipe` và `windowsHide: true`. Cờ bổ sung để quyền đi qua stdin (ví dụ `--permission-prompt-tool stdio`) chỉ được thêm nếu probe ở §8 cho thấy cần.

**Phiên chat trả về** nhận sự kiện qua `onEvent(cb)` (mỗi dòng JSON stdout đã parse) và `onExit(cb)`, và có các thao tác sau:

| Thao tác | Việc làm |
|---|---|
| `say(text)` | Ghi `{"type":"user","message":{"role":"user","content":text}}` vào stdin. |
| `answer(requestId, allow)` | Ghi `control_response` cho một `can_use_tool`. Cho phép thì `{behavior:"allow", updatedInput: <input gốc>}`; từ chối thì `{behavior:"deny", message:"Người dùng từ chối"}`. |
| `interrupt()` | Gửi `control_request` với subtype `interrupt`. |
| `kill()` | Tắt tiến trình. |

- Dòng stdout không phải JSON thì bỏ qua. stderr bị bỏ qua.
- Tự gỡ khỏi hub khi tiến trình thoát. `kill` được gọi nhiều lần vẫn an toàn và trả chỗ ngay.
- `killAll()` được gọi khi server tắt.
- Ghi vào stdin khi tiến trình đã thoát thì không làm gì.

Dạng chính xác của `control_request` / `control_response` và của tin nhắn `user` lấy theo kết quả probe ở §8. Bảng trên là dạng dự kiến.

### 3.2 Lịch sử — `history(file, n = 50)`

- Đọc file transcript `.jsonl` của phiên. Đường dẫn lấy từ `Watcher`/store, không tự ghép đường dẫn từ input của client.
- Trả về tối đa 50 lượt gần nhất, theo thứ tự cũ → mới:
  - `{role:"user", text}`: tin của người dùng, bỏ tin chỉ chứa `tool_result` và các thẻ hệ thống như `<command-name>`;
  - `{role:"claude", text}`: phần chữ của assistant;
  - `{role:"tool", name, summary}`: một dòng tóm tắt, dùng lại `summarize` có sẵn.
- Mỗi `text` cắt ở 20 000 ký tự. Chỉ đọc 4 MB cuối file.

### 3.3 Kênh `/chat`

Nâng cấp trên cùng HTTP server: `GET /chat?token=…&session=<id>`. Các bước kiểm tra trước khi nâng cấp giống hệt `/pty`:

| Kiểm tra | Mã trả |
|---|---|
| token sai hoặc thiếu | 401 |
| Origin sai | 403 |
| id không phải UUID hoặc không phải phiên đang theo dõi | 404 |
| đã đủ 3 phiên hoặc không có `claude` | 503 |
| spawn ném lỗi | 500, server không sập |

`cwd` là thư mục phiên nếu còn tồn tại, không thì `homedir()`. Nếu handshake hỏng thì tắt claude ngay (cờ `up` như `/pty`).

**Server gửi xuống (JSON text):**
- `{t:"history", items:[…]}`: gửi đầu tiên, ngay sau khi kết nối.
- `{t:"ev", e:<sự kiện stream-json nguyên văn>}`: mọi dòng stdout của claude. Client tự lọc.
- Khi claude thoát thì đóng kết nối với mã `4000`, lý do là mã thoát.

**Client gửi lên (JSON text), tối đa 256 KB mỗi tin:**
- `{t:"say", text}`: `text` là chuỗi không rỗng, tối đa 100 000 ký tự.
- `{t:"allow"|"deny", id}`: `id` phải là một `request_id` đang chờ trả lời. Id lạ thì bỏ qua.
- `{t:"stop"}`.

Mọi thứ khác bị bỏ qua, không đóng kết nối. Mọi lời gọi tới phiên chat trong handler đều được bọc `try/catch`.

**Kết thúc:**
- WebSocket đóng thì tắt claude.
- Câu hỏi xin quyền còn treo khi đóng thì mất theo tiến trình.

## 4. Client

### 4.1 Khung chat — `src/client/chat.ts`

`openChat(opts: { sessionId, title, token, onClose }, deps?)` tạo lớp phủ cùng kiểu khung terminal: khoảng 80vw × 80vh, nền tối, thanh tiêu đề "Chat — <tên dự án>" và nút ✕.

Thân khung là danh sách tin nhắn, cuộn được và tự cuộn xuống cuối khi có tin mới, trừ khi người dùng đang cuộn lên đọc.
- **Bong bóng người dùng** nằm bên phải, chữ thuần.
- **Bong bóng claude** nằm bên trái, render markdown bằng `marked`:
  - chạy với HTML thô bị tắt: mọi token `html` bị escape;
  - link chỉ nhận `http:` / `https:` và mở bằng `target="_blank" rel="noopener"`;
  - khối code dùng font monospace và có nút "Sao chép".
- **Chữ đang gõ dở** (`stream_event` / `content_block_delta` loại `text_delta`) được nối vào bong bóng claude đang mở. Khi có tin `assistant` hoàn chỉnh thì thay bằng bản cuối.
- **Tool call** (`tool_use` trong tin `assistant`) hiện thành dòng gập "🔧 <tên tool> — <tóm tắt input>". Mở ra thì thấy input JSON và kết quả (`tool_result` trong tin `user` kế tiếp), cắt ở 5 000 ký tự.
- **Thẻ xin quyền** (`control_request` có subtype `can_use_tool`):
  - hiện tên tool và phần chính của input (lệnh `command`, đường dẫn `file_path`, hoặc JSON rút gọn);
  - có nút **Cho phép** và **Từ chối**;
  - bấm xong thì khoá thẻ và ghi "Đã cho phép" / "Đã từ chối".
- **Kết thúc lượt** (`result`): một dòng nhỏ ghi thời gian và chi phí (`total_cost_usd`) nếu có. Nếu `is_error` thì hiện lỗi.
- **Lịch sử** được render y như tin mới, kèm vạch ngăn "— tin cũ —".

**Ô gõ** nằm dưới cùng:
- textarea tự giãn tối đa 8 dòng;
- Enter để gửi, Shift+Enter để xuống dòng;
- không gửi chuỗi rỗng.

Khi claude đang trả lời (từ lúc gửi tới khi có `result`), nút Gửi đổi thành **Dừng** và gửi `{t:"stop"}`. Vẫn gõ được nhưng chưa gửi được.

**Phím và đóng khung:**
- `keydown` không lan ra `document`. Esc khi đang trả lời thì dừng như nút Dừng; ngoài lúc đó Esc không làm gì.
- Chỉ ✕ mới đóng khung. Click vào phần khung ngoài ô gõ thì focus quay về ô gõ.
- Đóng với mã `4000` thì hiện dòng "Phiên đã kết thúc (mã X)" và khoá ô gõ. Kết nối lỗi thì hiện "Không kết nối được chat".
- Đóng khung (✕) thì đóng WebSocket, gỡ lớp phủ và gọi `onClose`.

**Một khung tại một thời điểm, chung cho cả chat và terminal:**
- `isChatOpen()` được export.
- Mở chat khi terminal đang mở (hoặc ngược lại) thì nút đó bị khoá.

### 4.2 Nút trong panel

Panel của thị trưởng có hai nút: **"Chat"** (nút chính) và **"Terminal"** (nút cũ, đổi nhãn).
- Hộp xác nhận "phiên có thể đang mở ở chỗ khác" dùng chung cho cả hai, cùng điều kiện (`working`/`waiting`) và cùng chữ như spec terminal.
- Khi một khung đang mở, cả hai nút bị khoá và hiện "Đang mở chat" hoặc "Terminal đang mở".

## 5. An toàn

- `/chat` có cùng các lớp bảo vệ với `/pty`:
  - chỉ nghe 127.0.0.1;
  - token, Origin;
  - UUID của phiên đang theo dõi;
  - mảng tham số cố định, không qua shell;
  - tối đa 3 phiên.
- Chữ của claude và của tool không bao giờ được chèn vào trang dưới dạng HTML thô. `marked` chỉ sinh HTML từ markdown, token HTML bị escape, và link bị lọc giao thức.
- Quyền tool:
  - mặc định hỏi người dùng (`--permission-prompts host`), không dùng chế độ bỏ qua quyền;
  - server chỉ trả lời các `request_id` mà chính claude đã hỏi.

## 6. Thư viện

`marked`, chỉ cho client, được Vite gói vào bản build. Phía server không thêm thư viện nào.

## 7. Test

- **`test/chat.test.ts`** (server, với `spawn` giả):
  - chạy đúng file và đúng mảng tham số;
  - trả `null` khi đã đủ 3 phiên;
  - phiên thoát thì trả chỗ, `kill` trả chỗ ngay;
  - `say`, `answer` (cho phép, từ chối), `interrupt` ghi đúng JSON vào stdin;
  - dòng stdout bị cắt giữa chừng hoặc không phải JSON vẫn được xử lý đúng;
  - ghi sau khi đã thoát thì không ném lỗi.
- **`test/chat-history.test.ts`** (file tạm, transcript giả):
  - lấy tối đa 50 lượt;
  - bỏ tin chỉ chứa `tool_result` và tin hệ thống;
  - tóm tắt tool;
  - cắt các chữ dài.
- **`test/http-chat.test.ts`**:
  - các mã 401, 403, 404, 503, 500;
  - `history` được gửi đầu tiên;
  - các tin `say`, `allow`, `deny`, `stop` tới đúng hub, id lạ bị bỏ qua;
  - đóng WebSocket thì `kill`, claude thoát thì đóng với mã 4000.
- **`test/chatui.test.ts`** (happy-dom, WebSocket giả):
  - render lịch sử;
  - chữ đang gõ dở được nối rồi được thay bằng bản cuối;
  - tool gập lại được;
  - thẻ xin quyền gửi đúng `allow`/`deny` rồi bị khoá;
  - markdown có `<script>` và link `javascript:` được escape hoặc bị lọc;
  - Enter gửi, Shift+Enter xuống dòng;
  - Dừng khi đang trả lời;
  - mã 4000 khoá ô gõ;
  - ✕ dọn sạch.
- **`test/panel.test.ts`:** hai nút; khi một khung đang mở thì cả hai bị khoá; hộp xác nhận dùng chung.
- **Kiểm tra bằng tay (người dùng làm):**
  - mở chat một phiên Nghỉ, hỏi một câu;
  - nhờ claude chạy `dir`, rồi thử Cho phép và Từ chối;
  - bấm Dừng giữa câu trả lời;
  - đóng rồi mở lại.

## 8. Rủi ro và probe

Phần chưa chắc là giao thức hỏi quyền qua stdin/stdout ở chế độ `-p` stream-json (`--permission-prompts host`). Task đầu tiên của plan là một probe chỉ để quan sát, label throwaway.
- Probe chạy `claude -p` với stream-json trong một thư mục tạm, **không** dùng `--resume` lên phiên thật.
- Nó gửi một câu ngắn yêu cầu chạy `echo hi`, rồi ghi lại nguyên văn các dòng:
  - `control_request`;
  - dạng `control_response` mà claude chấp nhận;
  - dạng `interrupt`.
- Probe tốn rất ít token (một lượt ngắn). Kết quả được ghi vào plan trước khi làm Task 2.
- Nếu `host` không dùng được ở CLI thì phương án dự phòng là `--permission-prompt-tool` với một MCP tool cục bộ. Khi đó phải dừng lại hỏi người dùng trước khi đổi thiết kế.
