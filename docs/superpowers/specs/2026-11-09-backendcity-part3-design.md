# BackendCity Part 3 — Mở phiên từ thành phố, model cho nhân viên

Ngày: 2026-11-09 · Trạng thái: chờ duyệt · Nối tiếp spec phần 1 và phần 2 (vẫn ràng buộc)

## 1. Mục tiêu

1. **Mở phiên Claude Code mới ngay từ thành phố:** chọn thư mục, model, (tuỳ chọn) model mặc định cho nhân viên, gõ yêu cầu → một tab Windows Terminal mở chạy `claude`. Phiên mới tự hiện thành trụ sở mới trong ≤ ~2 s sau khi Claude ghi transcript.
2. **Quy tắc model cho nhân viên** (đã chốt: biến môi trường + Explore):
   - Phiên mở từ thành phố có thể đặt **model mặc định cho mọi nhân viên** (`CLAUDE_CODE_SUBAGENT_MODEL`).
   - Tuỳ chọn **"Explore dùng Haiku"**: app tạo file agent `Explore` (docs Claude Code xác nhận file cùng tên ghi đè agent có sẵn và giữ `model` của nó). Áp dụng cho mọi phiên, kể cả phiên bạn tự mở.

Thành công khi: điền form, bấm "Mở", thấy terminal mở với Claude đúng thư mục + model, và trụ sở mới xuất hiện trong thành phố.

## 2. Đã kiểm chứng

- Claude Code CLI 2.1.319 đã cài (WinGet, chữ ký "Anthropic, PBC"), `claude` ở `~/.local/bin`. **Bạn cần đăng nhập 1 lần**: mở terminal, chạy `claude`, làm theo trình duyệt (nếu app desktop đã đăng nhập dùng chung thì có thể bỏ qua — chưa kiểm chứng).
- `wt.exe` (Windows Terminal) có sẵn.
- `claude --help`: có `--model <model>`, `--settings <file-or-json>`, prompt là tham số vị trí `[prompt]`.
- Docs subagent: thứ tự chọn model = model Claude truyền khi gọi → `model:` trong file agent → `CLAUDE_CODE_SUBAGENT_MODEL` → model của phiên. `CLAUDE_CODE_SUBAGENT_MODEL` **không** đổi model của Explore/Plan có sẵn (trừ khi thêm `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`). File agent tên `Explore` ở `~/.claude/agents/` ghi đè Explore có sẵn.
- `~/.claude/agents/` hiện có `csharp-reviewer.md`, `database-reviewer.md` của bạn — **không bao giờ đụng**.

## 3. Ngoài phạm vi

Gửi tin vào phiên đang chạy · duyệt quyền/dừng phiên từ thành phố · chọn model theo từng loại nhân viên ngoài Explore · Plan/general-purpose override (docs không xác nhận) · mở phiên trên máy khác.

## 4. Mở phiên

### 4.1 Giao diện

- Nút **"+ Mở phiên"** trên HUD → hộp thoại:
  - **Thư mục**: danh sách thư mục project đã thấy (từ `cwd` các phiên) + ô nhập đường dẫn tuyệt đối.
  - **Model**: Mặc định · Opus · Sonnet · Haiku · Fable (alias `opus`/`sonnet`/`haiku`/`fable`).
  - **Model cho nhân viên**: Không đặt · Haiku · Sonnet · Opus.
  - **Yêu cầu** (tuỳ chọn, ≤ 4000 ký tự).
  - Nút **Mở** → thông báo "Đã mở terminal" hoặc lỗi rõ ràng (thư mục không tồn tại, chưa có `claude`…).
- Mọi chữ hiển thị bằng `textContent`.

### 4.2 API

`POST /api/launch` body JSON `{ cwd: string, model?: Alias, subagentModel?: Alias, prompt?: string }`

- Cần token (như mọi `/api/*`) **và** `Origin` khớp server (như WebSocket) **và** `Content-Type: application/json` — chặn trang web lạ trong trình duyệt gửi form tới localhost để chạy lệnh.
- Kiểm tra: `cwd` là đường dẫn tuyệt đối, tồn tại, là thư mục (không UNC `\\`); `model`/`subagentModel` thuộc danh sách cho phép; `prompt` ≤ 4000 ký tự, không chứa ký tự điều khiển ngoài `\n` `\t`; body ≤ 16 KB.
- Lỗi → 400 `{"error": "<thông điệp tiếng Việt>"}`; không tìm thấy `claude` → 409 `{"error":"Chưa cài Claude Code CLI"}`; thành công → 202 `{"ok": true}`.

### 4.3 Chạy tiến trình

- Hàm thuần `buildLaunch(opts, env): { file: string; args: string[]; settingsJson?: string }`:
  - Có `wt.exe`: `wt.exe -w new new-tab -d <cwd> --title BackendCity <claude.exe> [--model m] [--settings <file>] [-- <prompt>]`.
  - Không có `wt.exe`: `cmd.exe /c start "BackendCity" /D <cwd> <claude.exe> …` (dự phòng).
  - Dấu `;` trong mọi tham số gửi qua `wt` được thoát thành `\;` (wt dùng `;` tách lệnh).
  - Prompt đặt sau `--` để prompt bắt đầu bằng `-` không bị hiểu là cờ.
- `subagentModel` → file settings tạm `%TEMP%\backendcity-<random>.json` = `{"env":{"CLAUDE_CODE_SUBAGENT_MODEL":"<alias>"}}`, truyền bằng `--settings <file>`; xoá file sau 60 s.
- `spawn(file, args, { detached: true, stdio: "ignore", shell: false })` + `unref()`. **Không bao giờ** dùng shell để ghép chuỗi lệnh.
- Đường dẫn `claude.exe` tìm 1 lần lúc khởi động: `where claude` → `~/.local/bin/claude.exe`.

## 5. Quy tắc model cho nhân viên

- Bảng nhỏ trong hộp thoại "Quy tắc model" (nút trên HUD): công tắc **"Explore dùng Haiku"** + trạng thái hiện tại.
- `GET /api/agents/explore` → `{ state: "off" | "on" | "user" }` (`user` = đã có `Explore.md` do bạn tự viết → app không đụng, công tắc bị khoá kèm lời giải thích).
- `PUT /api/agents/explore` `{ enabled: boolean }` (token + Origin + JSON):
  - Bật: ghi `~/.claude/agents/Explore.md` với frontmatter `name: Explore`, `description` (giống mô tả Explore có sẵn: tìm kiếm/đọc code nhanh, chỉ đọc), `tools: Read, Grep, Glob`, `model: haiku`, dòng đánh dấu `<!-- managed-by: BackendCity -->`, và prompt ngắn hướng dẫn khảo sát chỉ đọc.
  - Tắt: chỉ xoá file nếu có dòng đánh dấu.
  - Không bao giờ ghi/xoá file khác trong thư mục; ghi file qua tên tạm rồi đổi tên (không để file dở).
- Lưu ý hiển thị: "Áp dụng cho phiên mở sau khi bật; phiên đang chạy dùng cấu hình cũ." (Claude Code đọc lại thư mục agents trong vài giây — docs — nhưng không hứa trong UI.)

## 6. Kiến trúc thay đổi

| File | Thay đổi |
|---|---|
| `src/server/launch.ts` (mới) | `validateLaunch`, `buildLaunch`, `findClaude`, `launch` |
| `src/server/agents.ts` (mới) | `exploreState(dir)`, `setExplore(dir, enabled)` |
| `src/server/http.ts` | `POST /api/launch`, `GET/PUT /api/agents/explore`, đọc body JSON có giới hạn |
| `src/server/main.ts` | `findClaude()` lúc khởi động, truyền vào server |
| `src/client/launcher.ts` (mới) | hộp thoại mở phiên + hộp thoại quy tắc model |
| `src/client/hud.ts`, `index.html` | 2 nút + style hộp thoại |

## 7. Xử lý lỗi

| Trường hợp | Xử lý |
|---|---|
| Thiếu/ sai token, sai Origin, không phải JSON | 401 / 403 / 415 |
| Body > 16 KB | 413 |
| `cwd` không hợp lệ | 400 + lời nhắn |
| Không có `claude` | 409 + hướng dẫn cài |
| `spawn` lỗi (ENOENT…) | 500 `{"error":"Không mở được terminal"}`, server không crash |
| `Explore.md` của người dùng (không có dấu) | state `user`, PUT → 409 |
| Lỗi ghi file agents | 500 + lời nhắn, không để file dở |

## 8. Test

**Tự động:**
- `validateLaunch`: đường dẫn tương đối / không tồn tại / là file / UNC → lỗi; model ngoài danh sách → lỗi; prompt quá dài / ký tự điều khiển → lỗi.
- `buildLaunch`: có wt → đúng thứ tự tham số, `;` → `\;`, prompt sau `--`, không có shell; không wt → nhánh `cmd /c start`; `subagentModel` → `--settings <file>` và nội dung JSON đúng; không model → không có `--model`.
- `agents`: thư mục tạm — off→on tạo file có dấu + `model: haiku`; on→off xoá; file không dấu → `user`, không bị ghi/xoá; file khác trong thư mục không đổi.
- `http`: launch 401 không token, 403 sai Origin, 415 sai content-type, 413 body lớn, 400 cwd lạ, 202 với `launch` giả (inject) và không gọi spawn thật trong test; agents GET/PUT tương tự.
- Client: hộp thoại render bằng textContent; gửi đúng JSON; hiện lỗi server.

**Thủ công:** mở một phiên thật từ thành phố (sau khi bạn đăng nhập CLI) → terminal mở đúng thư mục/model, trụ sở mới xuất hiện; bật Explore Haiku → file được tạo đúng, tắt → xoá.
