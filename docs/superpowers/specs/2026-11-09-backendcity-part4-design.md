# BackendCity Part 4 — Vào trong building, thành phố chuyển động ngẫu nhiên

Ngày: 2026-11-09 · Trạng thái: chờ duyệt · Nối tiếp spec phần 1–3 (vẫn ràng buộc) · Nhánh `feat/part4` tách từ `feat/part3`

## 1. Mục tiêu

1. **Vào bên trong building:** bấm building khu vực → phòng của khu; bấm nhà trụ sở → văn phòng của phiên. Cảnh phòng thay cả khung bản đồ; người trong phòng bấm được, mở panel lịch sử có sẵn.
2. **Thành phố bớt "băng chuyền":** xe chạy ngẫu nhiên khắp mạng đường; thị trưởng/nhân viên đang làm đi lòng vòng gần cửa khu; thêm vài dân thường trang trí.

Thành công khi: vào/ra được mọi building, người trong phòng khớp với ngoài đường và cập nhật trực tiếp; xe và người nhìn không lặp lại theo một nhịp cố định.

## 2. Phạm vi

**Trong:** client (`src/client/*`) dùng dữ liệu sẵn có (WebSocket state + `GET /api/session/:id`). Server chỉ thêm API **kệ sách** (§4.5, chỉ đọc); các API và kiểu dữ liệu cũ giữ nguyên.

**Ngoài:** di chuyển nhân vật bằng bàn phím, vào phòng bằng cách đi bộ vào cửa, âm thanh, phòng trên/dưới nhiều tầng, xe tránh va chạm nhau, dân thường bấm được, sửa file từ kệ sách, `AGENTS.md`, skill của plugin cài qua app desktop (không nằm trong `~/.claude/plugins`).

## 3. Hình ảnh

- Tải **Kenney Roguelike Indoors** (CC0, ô 16 px, cách 1 px — cùng series với hai bộ đang dùng) vào `assets/kenney/roguelike-indoors/`, ghi nguồn + giấy phép vào `ASSETS.md`. Chỉ ảnh tilesheet + `License.txt` được commit.
- Bộ này **chỉ có đồ đạc, không có ô sàn/tường** → sàn và tường vẽ bằng khối màu theo khu (Graphics), đồ đạc là sprite. Chỉ số ô chọn trong kế hoạch, khai báo hằng số trong `tiles.ts` như bộ city.
- Không tải được tilesheet → phòng vẽ bằng khối màu (giống chế độ procedural hiện có), app không lỗi.

## 4. Vào phòng

### 4.1 Vào / ra

- Bấm **building khu vực** (vùng `city.plots`) → phòng khu đó. Hiện bấm building chưa làm gì.
- Bấm **nhà trụ sở có chủ** → văn phòng phiên đó (thay hành vi cũ: mở panel). Nhà trống vẫn không bấm được.
- Bấm **người ngoài đường** → mở panel như cũ (không vào phòng).
- Trong phòng: thành phố + xe + thẻ hover ẩn; HUD hiện nút **"← Về thành phố"** và tên phòng.
- **Esc** đóng lớp trên cùng trước: hộp thoại → panel → phòng. Một lần Esc chỉ đóng một lớp.
- Vào phòng không đóng panel đang mở. Ra phòng thì thành phố hiện lại đúng như trước (người đã đi tiếp theo dữ liệu mới).
- Phiên của văn phòng đang mở bị ẩn (`removed` trong delta) → tự về thành phố.

### 4.2 Phòng khu vực

- Khung chung: sàn + tường trên, cửa ở giữa tường dưới. Kích thước phòng cố định (vừa 12 bàn), co giãn theo cửa sổ như bản đồ (cùng quy tắc scale số nguyên).
- Mỗi khu khai báo trong một bảng dữ liệu: màu/ô sàn và 4–6 đồ đặc trưng đặt dọc tường, ví dụ Database: tủ máy chủ; Thư viện: kệ sách; Lab: bàn thí nghiệm; Nhà máy: máy móc; Sân bay: bản đồ/màn hình; Khu dân cư: ghế sofa, giường.
- **Người trong phòng** = thị trưởng các phiên có `district` = khu này + nhân viên `working` có `district` = khu này (cùng quy tắc với thẻ hover `presentAt`, nhưng giữ cả đối tượng). Mỗi người ngồi một bàn theo thứ tự ổn định (thị trưởng trước, rồi theo `startedAt`), tên trên đầu, huy hiệu `!`/`z` như ngoài đường, cùng trang phục như ngoài đường. Bấm → `panel.open(kind, id)`.
- Tối đa **12 bàn**; người thừa → nhãn "+N" ở cửa.
- Bảng trên tường: `label`, `sign`, `description`, `examples` từ `districtInfo` (vẽ bằng `textContent`/Text, không HTML).
- Phòng trống: dòng "Chưa ai làm ở đây".

### 4.3 Văn phòng trụ sở

- Thị trưởng ngồi bàn lớn giữa phòng.
- Nhân viên của phiên lấy từ `GET /api/session/:id` (`staff`): `working` ngồi bàn nhỏ; `done` → bàn trống có dấu ✓ và tên loại nhân viên. Tối đa 12 bàn nhỏ, ưu tiên `working`, rồi `done` mới nhất; thừa → "+N".
- Bảng trắng: `title` (hoặc `project`), trạng thái (Đang làm / Chờ bạn / Rảnh), `lastPrompt` cắt ≤ 120 ký tự. Không có → "—".
- Tải lại chi tiết khi vào và khi delta có phiên này hoặc nhân viên của phiên này (gộp, tối đa 1 lần/giây). Lỗi mạng → giữ cảnh cũ, dòng nhỏ "Không tải được, đang thử lại"; 404 → về thành phố.
- Bấm thị trưởng → panel phiên; bấm nhân viên (kể cả bàn ✓) → panel nhân viên.

### 4.4 Đồ đạc bấm được trong văn phòng

Đồ đạc có con trỏ tay và tên khi rê chuột. Hộp thoại dùng `showDialog` có sẵn (Esc đóng), chữ bằng `textContent`. Dữ liệu là `SessionDetail` đã tải cho văn phòng.

| Đồ | Bấm → |
|---|---|
| **Két sắt** | Hộp thoại "Két token": mỗi model một dòng (input / output / cache đọc / cache ghi) từ `tokens.byModel` của phiên (đã gồm nhân viên), dòng tổng, và dòng "Trong đó nhân viên: N token" = tổng 4 loại của mọi `staff[].tokens`. Không có token → "Chưa dùng token nào". |
| **Tủ hồ sơ** | Hộp thoại "Hồ sơ": nhân viên `done`, mới nhất trước (`endedAt`), mỗi dòng loại + mô tả + thời điểm xong; bấm dòng → đóng hộp thoại, `panel.open("employee", id)` (panel đã hiện báo cáo). Không có → "Chưa có báo cáo nào". |
| **Điện thoại** | Hộp thoại "+ Mở phiên" có sẵn, thư mục chọn sẵn = `cwd` của phiên (thêm vào danh sách nếu chưa có). Không có `cwd` → hộp thoại như nút HUD. |
| **Bản đồ** | Vào phòng khu vực `district` hiện tại của phiên. |
| **Kệ sách** | Hộp thoại "Kệ sách" (§4.5). |

### 4.5 Kệ sách: file nạp sẵn và skill

**Nguồn** (server tự tìm; client không bao giờ gửi đường dẫn):

- **File nạp sẵn:** `~/.claude/CLAUDE.md` (của bạn); `CLAUDE.md` và `.claude/CLAUDE.md` ở `cwd` của phiên và mọi thư mục cha tới gốc ổ (dự án); `CLAUDE.local.md` ở `cwd` (local). Chỉ file có thật.
- **Skill:** `~/.claude/skills/*/SKILL.md` (của bạn); `<cwd>/.claude/skills/*/SKILL.md` (dự án); với mỗi plugin trong `~/.claude/plugins/installed_plugins.json` → `<installPath>/skills/*/SKILL.md` (plugin, kèm tên plugin). `name`/`description` lấy từ frontmatter (dòng `name:`/`description:`; thiếu `name` → tên thư mục; mô tả cắt ≤ 200 ký tự).
- **Đã dùng:** server ghi lại tên skill mỗi khi phiên gọi tool `Skill` (`input.skill`); skill có tên trùng (kể cả dạng `plugin:skill`) được đánh dấu "đã dùng" và xếp lên đầu.
- Bỏ qua symlink; tối đa 300 skill; file lỗi đọc thì bỏ qua.

**API** (token như mọi `/api/*`, chỉ `GET`):

- `GET /api/session/:id/shelf` → `{ files: ShelfFile[], skills: ShelfSkill[] }`
  - `ShelfFile = { id, scope: "user" | "project" | "local", path, size }`
  - `ShelfSkill = { id, scope: "user" | "project" | "plugin", plugin?, name, description, used }`
  - `id` = 16 ký tự hex đầu của sha256 đường dẫn tuyệt đối.
- `GET /api/session/:id/shelf/:itemId` → `{ text, truncated }`: server liệt kê lại, tìm đúng `id`, đọc tối đa **64 KB** (UTF-8), `truncated` nếu dài hơn. `id` không có trong danh sách → 404. Không bao giờ đọc đường dẫn từ client.
- Phiên không tồn tại → 404.

**Giao diện:** hai mục "File nạp sẵn" (phạm vi + đường dẫn) và "Skill" (tên, phạm vi/plugin, mô tả, nhãn "đã dùng"). Bấm một dòng → nội dung trong `<pre>` (textContent) cùng hộp thoại, nút "← Kệ sách"; `truncated` → dòng "Đã cắt ở 64 KB". Rỗng → "Không thấy file hay skill nào". Lỗi tải → "Không tải được kệ sách".

## 5. Chuyển động ngẫu nhiên

Mọi chỗ ngẫu nhiên nhận hàm `rand: () => number` (mặc định `Math.random`) để test cố định được.

### 5.1 Xe

- Mạng đường = các giao lộ của `ROAD_ROWS`/`ROAD_COLS` (đường tâm 2 ô như hiện tại). Xe đi từ giao lộ tới giao lộ kề; tới giao lộ chọn ngẫu nhiên đều trong các hướng hợp lệ **trừ quay đầu** (chỉ quay đầu khi là ngõ cụt).
- **6 xe**, mỗi xe tốc độ ngẫu nhiên 2–4 ô/giây, xuất phát ở đoạn đường và hướng ngẫu nhiên. Sprite theo hướng như hiện tại.
- Không xử lý va chạm giữa xe (ngoài phạm vi).

### 5.2 Thị trưởng và nhân viên

- Đi đường ngắn nhất tới cửa khu như cũ. Tới nơi:
  - trạng thái `working` (thị trưởng) hoặc nhân viên → đi lòng vòng: chọn ngẫu nhiên một ô đường cách cửa ≤ 3 (khoảng cách Manhattan, ô đi được), đi tới, dừng ngẫu nhiên 1–4 s, lặp lại.
  - thị trưởng `waiting`/`idle` → đứng yên ở cửa.
- Khu thay đổi → bỏ lòng vòng, đi thẳng tới cửa mới.

### 5.3 Dân thường

- **5 người** trang trí: trang phục riêng (không trùng bảng trang phục nhân viên/thị trưởng), không nhãn, không bấm được (`eventMode = "none"`).
- Mỗi người: chọn ngẫu nhiên một ô đường bất kỳ, đi tới bằng `findPath`, dừng 1–4 s, lặp lại.
- Ẩn khi đang ở trong phòng (cùng thành phố).

### 5.4 Giảm chuyển động

`prefers-reduced-motion: reduce` → không xe, không lòng vòng, không dân thường (như cách `Traffic` đang làm). Người vẫn đi tới cửa khu.

## 6. Kiến trúc thay đổi

| File | Thay đổi |
|---|---|
| `src/client/roads.ts` (mới) | Đồ thị giao lộ từ `ROAD_ROWS`/`ROAD_COLS`; `nextDir(at, from, rand)`; `wanderTarget(walkable, door, radius, rand)` |
| `src/client/traffic.ts` | Xe đi theo đồ thị giao lộ, tốc độ/xuất phát ngẫu nhiên, 6 xe |
| `src/client/actors.ts` | Lòng vòng khi tới nơi; dân thường; `setVisible` cho chế độ phòng |
| `src/client/rooms.ts` (mới) | Bảng dữ liệu phòng theo khu; `roomOccupants(district, state)`; `officeLayout(detail)`; vẽ phòng (tiles hoặc khối màu); `tokenRows(detail)`, `fileRows(detail)` cho két/tủ |
| `src/client/scene.ts` (mới) | Trạng thái cảnh `city` / `room(district)` / `office(sessionId)`; vào/ra; Esc theo lớp |
| `src/client/tiles.ts` | Nạp tilesheet indoors + hằng số chỉ số ô |
| `src/client/launcher.ts` | `renderLaunchDialog` nhận thư mục chọn sẵn; hộp thoại két token, hồ sơ |
| `src/client/main.ts`, `hud.ts`, `index.html` | Bấm building/HQ → vào phòng; nút "← Về thành phố"; nối delta vào cảnh |
| `assets/kenney/roguelike-indoors/`, `ASSETS.md` | Tilesheet + giấy phép |
| `src/server/shelf.ts` (mới) | `listShelf(cwd, claudeDir, used)`, `readShelfItem(...)` |
| `src/server/store.ts`, `http.ts`, `main.ts` | Ghi tên skill đã gọi; 2 route kệ sách; truyền `claudeDir` |

## 7. Xử lý lỗi

| Trường hợp | Xử lý |
|---|---|
| Không tải được tilesheet indoors | Phòng vẽ khối màu, không lỗi |
| Kệ sách: file lỗi đọc / thư mục không tồn tại | Bỏ qua mục đó |
| `GET /api/session/:id` lỗi mạng | Giữ cảnh cũ + dòng "Không tải được, đang thử lại" |
| 404 / phiên bị ẩn khi đang trong văn phòng | Về thành phố |
| Mất kết nối WebSocket trong phòng | Giữ cảnh, HUD báo như hiện tại |
| Khu không có trong bảng phòng | Dùng phòng mặc định (sàn trơn, không đồ đặc trưng) |
| Không có ô đường trong bán kính lòng vòng | Đứng yên ở cửa |

## 8. Test

**Tự động (Vitest, `rand` cố định):**
- `roads`: đồ thị đủ giao lộ; `nextDir` không bao giờ quay đầu khi có lựa chọn khác, luôn ra cạnh có thật; ngõ cụt → quay đầu.
- Xe: sau nhiều bước ngẫu nhiên vị trí luôn nằm trên đường tâm; tốc độ trong 2–4 ô/s.
- `wanderTarget`: luôn là ô đi được, cách cửa ≤ 3; không có ô → trả về cửa.
- `roomOccupants`: đúng người theo `district`, thứ tự ổn định, cắt 12 + đếm thừa; nhân viên `done` không vào phòng khu vực.
- `officeLayout`: `working` trước, `done` sau, cắt 12; bảng trắng cắt 120 ký tự, thiếu dữ liệu → "—".
- `tokenRows`: đúng dòng theo model + tổng + phần nhân viên; rỗng → "Chưa dùng token nào". `fileRows`: chỉ `done`, mới nhất trước. Hộp thoại mở phiên chọn sẵn `cwd` (thêm vào danh sách khi thiếu).
- `scene`: vào/ra; Esc đóng đúng lớp trên cùng; phiên bị ẩn khi ở văn phòng → về thành phố.
- Text trên bảng/nhãn render bằng `textContent`/Text (không HTML).

- `shelf` (thư mục tạm, không đọc `~/.claude` thật): đủ 3 loại file theo phạm vi kể cả thư mục cha; skill từ 3 nguồn + frontmatter thiếu `name`; `used` theo tên và `plugin:skill`; symlink bị bỏ; đọc nội dung > 64 KB → `truncated`; `itemId` lạ / chuỗi đường dẫn → 404; phiên lạ → 404; thiếu token → 401.
- Store: tool `Skill` ghi tên skill vào phiên, không trùng lặp.

**Thủ công:** vào từng khu và vài trụ sở, bấm người trong phòng mở đúng panel; ra/vào nhiều lần không rò sprite; xe đi khắp các đường và rẽ khác nhau; người làm việc lòng vòng gần cửa; bật giảm chuyển động → đứng yên.
