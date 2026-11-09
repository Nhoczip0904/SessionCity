# BackendCity Part 2 — Trụ sở, nhân viên, làm đẹp thành phố

Ngày: 2026-11-09 · Trạng thái: chờ duyệt · Nối tiếp `2026-11-09-backendcity-design.md` (spec gốc, vẫn ràng buộc)

## 1. Mục tiêu

1. **Trụ sở + nhân viên:** bấm vào thị trưởng hoặc trụ sở → xem phiên đó làm gì; bấm nhân viên → xem thị trưởng giao gì, nhân viên đã làm gì, báo cáo lại gì.
2. **Thành phố đẹp hơn:** thay hình tự vẽ bằng bộ pixel CC0 Kenney (Roguelike Modern City + Roguelike Characters, đã có trong `assets/kenney/`).
3. **Note cho toà nhà:** mỗi khu có biển 1 dòng luôn hiện + thẻ chi tiết khi rê chuột.

Thành công khi: mở app, nhìn là hiểu từng khu để làm gì; bấm một nhân viên đang chạy thấy đúng lời giao việc và các bước nó đã làm, cập nhật trong ~2 s.

## 2. Ngoài phạm vi

Mở phiên mới / chọn model (phần 3) · ngân sách, diff, bảng tin, tua lại (phần 4) · sửa gì vào phiên Claude Code · hình ảnh động phức tạp (đổi hướng nhân vật theo 4 phía là đủ).

## 3. Dữ liệu chi tiết (server)

### 3.1 Lịch sử công cụ

Store giữ cho **mỗi thị trưởng và mỗi nhân viên** một vòng đệm 100 bước gần nhất:

```ts
interface ToolStep { at: string; name: string; summary: string; district: District | null }
```

`summary` ≤ 200 ký tự, lấy từ input:

| Công cụ | summary |
|---|---|
| `Bash` | `command` |
| `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | đường dẫn file (`file_path` / `notebook_path`) |
| `Grep` | `pattern` (+ ` in <path>` nếu có) |
| `Glob` | `pattern` |
| `WebFetch` / `WebSearch` | `url` / `query` |
| `Agent` / `Task` | `subagent_type: description` |
| khác | tên công cụ |

Hàm thuần `summarize(name, input): string` trong `src/server/summary.ts`, có test.

### 3.2 Báo cáo và lời giao việc

- Lời giao việc (`prompt`) và báo cáo cuối (`report`) giữ tối đa 4096 ký tự (như phần 1); khi bị cắt, UI ghi "(đã rút gọn — xem đầy đủ trong transcript)".
- Nhân viên lưu thêm `report?: string` (text của tool_result khớp `toolUseId`) và `models: string[]` (model từ usage của nó).
- Thị trưởng lưu thêm `lastPrompt?: string` (yêu cầu gần nhất của người dùng, ≤ 4096) để panel trụ sở hiện "đang làm theo yêu cầu gì".

### 3.3 API mới (cùng token như `/api/state`)

| Route | Trả về |
|---|---|
| `GET /api/session/:id` | `SessionDetail` = `Session` + `lastPrompt` + `steps: ToolStep[]` (mới nhất trước) + `employees: Employee[]` (cả đã xong trong 30 s) |
| `GET /api/employee/:id` | `EmployeeDetail` = `Employee` + `prompt` + `report` + `models` + `steps` |
| id không tồn tại | 404 `{"error":"not found"}` |

Delta WebSocket **không** mang `steps`/`report` (giữ nhẹ). Client đang mở panel tự lấy lại chi tiết khi delta có id đó (tối đa 1 lần/giây).

## 4. Panel (client, DOM overlay — không vẽ bằng Pixi để chữ sắc nét, chọn/copy được)

- **Bấm thị trưởng hoặc toà trụ sở của phiên** → panel bên phải (360 px; điện thoại: toàn màn hình):
  - Tên project, nhánh git, model, trạng thái (badge màu), hoạt động lần cuối ("2 phút trước").
  - "Yêu cầu gần nhất" (lastPrompt, gập/mở).
  - Token: vào / ra / cache (theo model).
  - **Nhân viên** (đang làm trước, rồi đã xong): loại · mô tả · trạng thái · thời gian chạy. Bấm → panel nhân viên.
  - **Hoạt động gần đây** của thị trưởng: 20 bước cuối (giờ · biểu tượng khu · công cụ · summary).
- **Bấm nhân viên** (trên bản đồ hoặc trong danh sách) → panel nhân viên:
  - Loại, mô tả, trạng thái, thời gian chạy, model.
  - **"Thị trưởng giao việc"**: lời giao việc đầy đủ (font mono, xuống dòng giữ nguyên).
  - **Các bước đã làm**: timeline 100 bước.
  - **"Báo cáo lại"**: báo cáo cuối (hoặc "Đang làm…").
  - Nút ← quay về trụ sở.
- Đóng: nút ✕ hoặc `Esc`. Panel cập nhật trực tiếp khi đang mở.
- Mọi văn bản từ transcript chèn bằng `textContent` (không bao giờ `innerHTML`) — transcript có thể chứa HTML/script.

## 5. Làm đẹp thành phố

### 5.1 Bản đồ (giữ nguyên lưới 48×32, đường, cửa — logic tìm đường và test phần 1 không đổi)

Dựng bằng `tilemap_packed.png` (16×16, không khoảng cách):
- Đường nhựa có vạch giữa, **vạch qua đường** ở các ngã tư, **vỉa hè** bao quanh mỗi lô.
- Cỏ, cây, bồn hoa, đèn đường, ghế, vài ô tô đỗ ven đường cho có sức sống.
- **Mỗi khu một toà nhà riêng** ghép từ tile mặt tiền, đủ khác nhau để nhận ra:

| Khu | Gợi ý hình |
|---|---|
| Toà thị chính | toà lớn trắng, cờ, bậc thềm |
| Thư viện | gạch đỏ, cửa sổ vòm |
| Toà thiết kế | kính xanh |
| Công trường | khung giàn, rào vàng đen, thùng hàng |
| Kho dữ liệu | nhà kho mái tôn, thùng |
| Phòng thí nghiệm | trắng, cửa kính, mái phẳng |
| Toà review | văn phòng xám, nhiều cửa sổ |
| Nhà máy | xưởng mái răng cưa, ống khói |
| Sân bay | đường băng/bãi đỗ, vạch kẻ |
| Tháp canh | toà cao hẹp, anten |
| Khu dân cư | nhà nhỏ mái ngói, sân |
| Trụ sở (14 lô) | văn phòng nhỏ giống nhau, cửa mang màu của phiên |

- Ánh sáng: một lớp phủ nhẹ (gradient) — không đổi theo giờ.
- **Xe chạy trang trí:** 3–5 ô tô chạy vòng trên đường (chỉ để đẹp, không mang dữ liệu); tắt được bằng `prefers-reduced-motion`.
- Tile cụ thể (chỉ số trong sheet) do người làm chọn khi nhìn sheet; ghi vào `src/client/tiles.ts` dạng hằng có tên (`ROAD_H`, `CROSSWALK`, `LIB_ROOF_L`…), không rải số khắp nơi.

### 5.2 Nhân vật (`roguelikeChar_transparent.png`, 16×16, cách 1 px)

- Ghép lớp: thân + áo + tóc/mũ (+ phụ kiện).
- **Thị trưởng:** vest + mũ/cà vạt; màu áo theo phiên (bảng 8–12 màu có sẵn trong sheet).
- **Nhân viên:** đồng phục theo loại agent:

| Loại | Trang phục |
|---|---|
| `Explore` | áo khoác + kính lúp/sách |
| `Plan` | áo sơ mi + giấy cuộn |
| `general-purpose` | áo phông |
| có chữ `review` | áo vest xám |
| có chữ `test` | áo blouse trắng |
| khác | áo phông màu xám |

- Đi bộ: nảy nhẹ + lật trái/phải theo hướng đi (sheet không có hoạt ảnh bước chân).
- Giữ "!" (chờ bạn), "z" (nghỉ), "+N" như phần 1.

### 5.3 Note cho toà nhà

- **Biển nhỏ 1 dòng** luôn hiện dưới tên toà, ví dụ Phòng thí nghiệm: "Chạy test".
- **Rê chuột lên toà** → thẻ (DOM) gồm: tên khu · giai đoạn · mô tả 1–2 câu · "Agent tới đây khi…" (ví dụ lệnh/công cụ, lấy từ nội dung soạn sẵn) · "Đang có mặt: …" (thị trưởng/nhân viên đang ở khu, tối đa 6 tên).
- Nội dung soạn sẵn trong `src/shared/districts.ts` (mở rộng `DISTRICTS`): `sign`, `description`, `examples: string[]`. Ví dụ:

| Khu | sign | description | examples |
|---|---|---|---|
| Thư viện | Khảo sát code | Đọc và tìm kiếm trong code, tài liệu, web trước khi làm. | Read, Grep, Glob, WebSearch |
| Toà thiết kế | Thiết kế & kế hoạch | Viết spec, kế hoạch, todo cho tính năng. | TodoWrite, Plan mode, sửa `docs/**`, `*.md` |
| Công trường | Viết code | Sửa và tạo file mã nguồn. | Edit, Write |
| Kho dữ liệu | Migration DB | Thay đổi schema, chạy migration, truy vấn DB. | `dotnet ef`, `prisma`, `*.sql`, `Migrations/` |
| Phòng thí nghiệm | Chạy test | Chạy bộ test và đọc kết quả. | `dotnet test`, `npm test`, `pytest` |
| Toà review | Review & Git | Xem diff, commit, mở/duyệt PR. | `git diff`, `git commit`, `gh pr` |
| Nhà máy | Build / CI | Biên dịch, đóng gói, chạy CI. | `dotnet build`, `npm run build`, `docker build` |
| Sân bay | Deploy | Đẩy code, triển khai môi trường. | `git push`, `docker push`, `kubectl apply` |
| Tháp canh | Giám sát | Xem log, kiểm tra sức khoẻ dịch vụ. | `docker logs`, `kubectl logs`, `curl …/health` |
| Toà thị chính | Chờ bạn | Thị trưởng nhận yêu cầu hoặc đang chờ bạn trả lời. | (khi Claude kết thúc lượt) |
| Khu dân cư | Nghỉ | Phiên không hoạt động quá 10 phút. | — |

## 6. Kiến trúc thay đổi

| File | Thay đổi |
|---|---|
| `src/server/summary.ts` (mới) | `summarize(name, input)` |
| `src/server/store.ts` | vòng đệm `steps`, `report`, `models`, `lastPrompt`; `detailSession(id)`, `detailEmployee(id)` |
| `src/server/http.ts` | 2 route chi tiết |
| `src/shared/types.ts` | `ToolStep`, `SessionDetail`, `EmployeeDetail` |
| `src/shared/districts.ts` | `sign`, `description`, `examples` |
| `src/client/tiles.ts` (mới) | nạp 2 sheet, cắt texture, hằng tên tile |
| `src/client/city.ts` | vẽ bằng tile (cùng lưới/cửa) + biển + vùng hover |
| `src/client/actors.ts` | sprite ghép lớp, lật hướng, click |
| `src/client/panel.ts` (mới) | panel trụ sở / nhân viên |
| `src/client/tooltip.ts` (mới) | thẻ hover toà nhà |
| `src/client/traffic.ts` (mới) | xe trang trí |

Asset được Vite đóng gói (import URL), không tải từ mạng.

## 7. Xử lý lỗi

- Chi tiết 404 (phiên/nhân viên vừa bị ẩn) → panel hiện "Phiên này đã kết thúc" và giữ dữ liệu lần cuối.
- Lỗi mạng khi lấy chi tiết → giữ dữ liệu cũ, thử lại ở delta kế tiếp.
- Sheet ảnh không nạp được → rơi về hình tự vẽ của phần 1 (không màn hình trắng).

## 8. Test

**Tự động:**
- `summary`: mỗi hàng bảng §3.1, cắt 200 ký tự, input lạ/null.
- `store`: vòng đệm giữ đúng 100 bước mới nhất cho thị trưởng và nhân viên; report gắn đúng nhân viên; `lastPrompt` cập nhật; models không trùng; `detailSession`/`detailEmployee` trả đúng, id lạ → `undefined`.
- `http`: 2 route cần token (401), id lạ → 404, id đúng → đúng hình dạng.
- `districts`: mọi `District` có `sign`, `description`, `examples`.
- Panel: hàm dựng DOM thuần (`renderEmployee(detail): HTMLElement`) test bằng DOM ảo của Vitest (`happy-dom`, dev dependency): chuỗi `<script>` trong prompt hiện ra dưới dạng chữ, không thành thẻ.

**Thủ công (controller xem trên trình duyệt):** bản đồ dùng tile Kenney, 11 khu nhận ra được, biển + thẻ hover đúng nội dung, bấm thị trưởng/nhân viên mở đúng panel, panel cập nhật khi phiên chạy.
