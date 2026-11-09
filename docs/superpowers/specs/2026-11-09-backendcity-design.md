# BackendCity — Thiết kế

Ngày: 2026-11-09 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Một thành phố pixel chạy trên trình duyệt, hiển thị **các phiên Claude Code thật** trên máy theo các giai đoạn làm một tính năng backend. Mỗi phiên là một **trụ sở**: **thị trưởng** là agent chính, **nhân viên** là agent phụ (subagent).

- Dùng hằng ngày để nhìn nhanh: phiên nào đang làm gì, ở giai đoạn nào, đang chờ mình, tốn bao nhiêu token.
- Để trong portfolio: phần server đọc luồng nhật ký lớn theo kiểu nối đuôi, WebSocket thời gian thực, bộ phân loại giai đoạn có test.

Thành công khi: đang chạy một phiên Claude Code bằng CLI, mở BackendCity thì thấy thị trưởng của phiên đó đi tới đúng khu trong vòng ~2 giây sau mỗi lệnh công cụ, và bấm vào sẽ xem được lời giao việc cho từng nhân viên.

## 2. Quyết định đã chốt

| # | Quyết định |
|---|---|
| Nguồn dữ liệu | Chỉ **đọc** nhật ký Claude Code trong `~/.claude/projects/`. Không dùng API key, không dùng Claude Agent SDK |
| Điều khiển | Phần agent **chỉ hiển thị**. Ô chat chỉ **mở phiên mới**: chọn thư mục + model + yêu cầu → mở cửa sổ terminal chạy `claude`. Duyệt quyền, dừng phiên làm trong terminal như bình thường |
| Chọn model cho nhân viên | App sinh file agent trong `~/.claude/agents/` với `model:` theo quy tắc; Claude Code CLI tự áp dụng cho mọi phiên |
| Công nghệ | Node.js ≥ 20 + TypeScript. Server: `node:http` + thư viện `ws`. Client: Vite + PixiJS v8. Test: Vitest |
| Đồ hoạ | Bộ tile/nhân vật pixel **CC0** (Kenney.nl), ghi nguồn trong `ASSETS.md`. Không dùng asset của Pixel Agents |
| Chi phí | Ước tính từ `usage` trong nhật ký × bảng giá cấu hình được. Chỉ để xem |

## 3. Ngoài phạm vi

Gửi tin nhắn vào phiên đang chạy · duyệt quyền / dừng phiên từ thành phố · đặt trần chi phí · dữ liệu Git/CI/Jira · nhiều người dùng / truy cập từ máy khác · agent khác ngoài Claude Code.

## 4. Lộ trình (mỗi phần một spec chi tiết → plan → code)

| Phần | Nội dung | Spec này |
|---|---|---|
| **1. Thành phố + quan sát** | Server đọc nhật ký, phân loại giai đoạn, WebSocket; bản đồ có đường và các khu; thị trưởng đi giữa các khu; nhân viên xuất hiện/đi/về | **Chi tiết** |
| 2. Trụ sở + nhân viên | Bảng trụ sở, danh sách nhân viên, lịch sử giao việc, timeline công cụ, báo cáo cuối | Phác thảo §9 |
| 3. Mở phiên + model | Form mở phiên (thư mục, model, yêu cầu) → terminal; quy tắc model cho nhân viên | Phác thảo §9 |
| 4. Phần thêm | Ngân sách, công trình (file đã sửa + diff), bảng tin, thông báo, xem lại phiên cũ | Phác thảo §9 |

Mô hình dữ liệu ở §6 đủ cho cả 4 phần để các phần sau không phải đổi cấu trúc.

## 5. Dữ liệu nguồn (đã kiểm tra trên máy, Claude Code bản hiện tại)

```
~/.claude/projects/<cwd-mã-hoá>/<sessionId>.jsonl                 phiên chính (thị trưởng)
~/.claude/projects/<cwd-mã-hoá>/<sessionId>/subagents/agent-<id>.jsonl      nhân viên
~/.claude/projects/<cwd-mã-hoá>/<sessionId>/subagents/agent-<id>.meta.json  { agentType, description, toolUseId, spawnDepth, ... }
```

- Mỗi dòng là một bản ghi JSON có `type` (`user`, `assistant`, `system`, `attachment`, `custom-title`, `agent-name`, …), `uuid`, `timestamp`, `sessionId`, `cwd`, `gitBranch`, `isSidechain`.
- `assistant`: `message.model`, `message.content[]` (khối `text`, `tool_use{id,name,input}`), `message.usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`.
- `user`: lời người dùng, hoặc `tool_result{tool_use_id, content}`.
- Giao việc: `tool_use` có `name` = `Agent` (bản cũ: `Task`), `input{description, subagent_type, prompt}`. Nhân viên nối với lời giao việc qua `meta.json.toolUseId` = `tool_use.id`. Báo cáo cuối = `tool_result` có `tool_use_id` đó.
- File có thể rất lớn (đã thấy 58 MB). Định dạng không có tài liệu chính thức → **bộ đọc phải chịu được trường lạ, dòng hỏng, loại bản ghi mới** (bỏ qua, không crash).

## 6. Kiến trúc

```
src/shared/   types.ts (sự kiện + trạng thái), districts.ts (danh sách khu)
src/server/   tail.ts · parse.ts · classify.ts · store.ts · watch.ts · http.ts · main.ts
src/client/   main.ts · map.ts · path.ts · sprites.ts · hud.ts
config/       districts.json (quy tắc phân loại) · prices.json
```

| Thành phần | Nhiệm vụ | Phụ thuộc |
|---|---|---|
| `tail` | Đọc phần mới của file từ byte offset, tách dòng hoàn chỉnh (giữ phần dòng dở cho lần sau), xử lý file bị cắt ngắn (offset > size → đọc lại từ 0) | `node:fs` |
| `parse` | Dòng JSON → `Event` chuẩn hoá (§6.1). Dòng hỏng/loại lạ → bỏ qua + đếm | — (thuần) |
| `classify` | `(toolName, input) → District \| null` theo `config/districts.json` (§7); `null` = giữ khu hiện tại | — (thuần) |
| `store` | Trạng thái trong bộ nhớ: phiên, thị trưởng, nhân viên, khu hiện tại, token; nhận `Event`, phát `Delta` | `parse`, `classify` |
| `watch` | Tìm phiên (quét thư mục mỗi 2 s + `fs.watch` khi có), gắn `tail` cho file đang hoạt động | `tail` |
| `http` | Phục vụ client đã build, REST `GET /api/state`, WebSocket `/ws` đẩy `Delta`. Bảo mật §8 | `ws` |
| Client | PixiJS vẽ bản đồ tile, nhân vật, tìm đường A* trên lưới đường, HUD đơn giản | `pixi.js` |

### 6.1 Mô hình dữ liệu

```ts
type District = "townhall" | "library" | "design" | "site" | "database" | "lab" | "review" | "factory" | "airport" | "watchtower" | "home";

interface Session  { id; project; cwd; branch?; title?; model?; lastActivity; status: "working" | "waiting" | "idle"; district: District; tokens: Tokens; employees: string[] }
interface Employee { id; sessionId; type; description; prompt; toolUseId; status: "working" | "done"; district: District; startedAt; endedAt?; tokens: Tokens }
interface Tokens   { input; output; cacheRead; cacheWrite; byModel: Record<string, {input; output; cacheRead; cacheWrite}> }

type Event =
  | { kind: "prompt"; sessionId; at }                                   // người dùng gửi yêu cầu
  | { kind: "tool"; sessionId; agentId?; at; name; input; district: District | null } // một lệnh công cụ
  | { kind: "spawn"; sessionId; at; toolUseId; type; description; prompt }
  | { kind: "report"; sessionId; at; toolUseId; text }                  // tool_result của Agent
  | { kind: "turnEnd"; sessionId; agentId?; at }                       // assistant dừng, không tool_use
  | { kind: "usage"; sessionId; agentId?; model; usage }
  | { kind: "meta"; sessionId; title?; branch?; cwd? };
```

Chuỗi dài (prompt, input, báo cáo) cắt còn 4 KB trong `store`; phần 2 lấy bản đầy đủ theo byte offset khi cần.

### 6.2 Trạng thái phiên

- `working`: có sự kiện trong 60 s gần nhất và lượt cuối chưa `turnEnd`.
- `waiting`: lượt cuối là `turnEnd` (Claude đã trả lời, đang chờ bạn) → thị trưởng về `townhall`.
- `idle`: không có sự kiện quá 10 phút → về `home`. Phiên không hoạt động quá 24 h không hiển thị.

## 7. Các khu và quy tắc phân loại

| Khu | Giai đoạn | Mặc định khi |
|---|---|---|
| `townhall` Toà thị chính | Yêu cầu / chờ bạn | `prompt`, `waiting` |
| `library` Thư viện | Khảo sát code | `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, `LS` |
| `design` Toà thiết kế | Thiết kế API/DB, kế hoạch | `TodoWrite`, `EnterPlanMode`, `ExitPlanMode`; `Write`/`Edit` vào `docs/**`, `*.md` |
| `site` Công trường | Code | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` (còn lại) |
| `database` Kho dữ liệu | Migration DB | Bash khớp `dotnet ef`, `migrat`, `prisma`, `flyway`, `liquibase`, `psql`, `sqlcmd`; sửa file `**/Migrations/**`, `*.sql` |
| `lab` Phòng thí nghiệm | Test | Bash khớp `dotnet test`, `npm (run )?test`, `vitest`, `jest`, `pytest`, `go test`, `mvn test` |
| `review` Toà review | Review & Git | Bash khớp `git (diff|log|commit|status|merge|rebase)`, `gh pr` |
| `factory` Nhà máy | Build / CI | Bash khớp `dotnet build`, `npm run build`, `tsc`, `docker build`, `gh run` |
| `airport` Sân bay | Deploy | Bash khớp `git push`, `docker push`, `kubectl apply`, `az `, `vercel`, `deploy` |
| `watchtower` Tháp canh | Giám sát | Bash khớp `docker logs`, `kubectl logs`, `curl .*health`, `tail -f` |
| `home` Khu dân cư | Nghỉ | `idle` |

- Bash không khớp quy tắc nào → giữ khu hiện tại.
- `Agent`/`Task` → thị trưởng ở lại khu hiện tại; nhân viên mới xuất hiện ở trụ sở.
- Quy tắc nằm trong `config/districts.json` (regex theo thứ tự, quy tắc đầu khớp thắng) để sửa không cần build lại.

## 8. Bảo mật

Nhật ký chứa code và có thể chứa bí mật.

- Server chỉ lắng nghe `127.0.0.1`, cổng mặc định 4317 (đổi bằng `--port`).
- Mỗi lần chạy sinh token ngẫu nhiên; URL in ra có `?token=`. Mọi request REST và WebSocket thiếu/sai token → 401. WebSocket kiểm tra thêm `Origin` phải là chính server (chặn trang web lạ trong trình duyệt kết nối tới localhost).
- Chỉ đọc `~/.claude/projects/`. Phần 1 không ghi gì ra ngoài thư mục app.
- Không gửi dữ liệu ra mạng; client không tải gì từ CDN.

## 9. Phác thảo phần 2–4 (chi tiết hoá ở spec riêng)

- **Phần 2 — Trụ sở + nhân viên:** bấm thị trưởng/trụ sở → panel: project, nhánh, model, trạng thái, token; danh sách nhân viên (loại, mô tả, trạng thái). Bấm nhân viên → lời giao việc đầy đủ, timeline công cụ, báo cáo cuối, token.
- **Phần 3 — Mở phiên + model:** form thư mục (chọn từ các project đã thấy) + model + yêu cầu → `wt.exe -d <cwd> claude --model <m> <yêu-cầu>` (dự phòng `cmd /c start`). Không chạy qua shell; model trong danh sách cho phép; thư mục phải tồn tại. Quy tắc model nhân viên: app chỉ tạo/sửa file **có tiền tố `city-`** trong `~/.claude/agents/`, chỉ khi bấm "Áp dụng", không đụng file khác. *Cần kiểm chứng trước khi làm:* file agent trùng tên agent có sẵn (`Explore`, `general-purpose`) có ghi đè được model không, hay phải dùng biến môi trường chọn model mặc định cho subagent.
- **Phần 4:** ngân sách (token × `config/prices.json`, theo phiên/model/ngày); công trình (file đã sửa từ input `Edit`/`Write`, diff hiển thị từ `old_string`/`new_string`); bảng tin; thông báo trình duyệt khi phiên chuyển `waiting`/lỗi; tua lại phiên cũ theo `timestamp`.

## 10. Hiệu năng

- Lần đầu chỉ đọc phiên có hoạt động trong 24 h; đọc từ cuối file ngược lên tối đa 2 MB để dựng trạng thái hiện tại, rồi nối đuôi.
- Đẩy `Delta` gộp mỗi 250 ms.
- Client: một `Container` cho bản đồ (vẽ một lần), sprite nhân vật dùng chung texture; mục tiêu 60 fps với 50 nhân vật.

## 11. Xử lý lỗi

| Trường hợp | Xử lý |
|---|---|
| Dòng JSON hỏng / dòng đang ghi dở | Giữ phần dở chờ lần đọc sau; dòng hỏng hoàn chỉnh → bỏ qua, đếm |
| Loại bản ghi / trường lạ | Bỏ qua |
| File bị xoá / đổi tên / cắt ngắn | Gỡ tail; cắt ngắn → đọc lại từ 0 |
| `~/.claude/projects` chưa có | Thành phố trống + dòng hướng dẫn |
| WebSocket rớt | Client tự nối lại (1 s, 2 s, 4 s… tối đa 10 s), lấy lại `/api/state` |
| Lỗi đọc file (khoá, quyền) | Bỏ qua lượt này, thử lại lần quét sau |

## 12. Test

**Tự động (Vitest):**
- `tail`: dòng bị cắt giữa hai lần đọc; nhiều dòng một lần; file bị cắt ngắn; CRLF.
- `parse`: từng loại bản ghi ở §5 dựng từ fixture **tự viết** (không dùng nhật ký thật vì chứa code công ty); `Agent` và `Task`; dòng hỏng; trường lạ.
- `classify`: mỗi hàng của bảng §7, Bash không khớp → `null`, thứ tự quy tắc.
- `store`: spawn → report nối đúng nhân viên; `turnEnd` → `waiting`; idle sau 10 phút (đồng hồ giả); cộng token theo model.
- `path`: A* trên lưới đường, không có đường → đứng yên.
- `http`: thiếu token → 401; sai `Origin` WebSocket → từ chối.

**Thủ công:** chạy một phiên Claude Code thật (Read → Edit → `dotnet test` → `git commit`), thấy thị trưởng đi Thư viện → Công trường → Phòng thí nghiệm → Toà review; gọi một subagent thấy nhân viên xuất hiện rồi về.
