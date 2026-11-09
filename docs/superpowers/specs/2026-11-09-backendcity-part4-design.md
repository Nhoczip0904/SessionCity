# BackendCity Part 4 — Vào trong building, thành phố chuyển động ngẫu nhiên

Ngày: 2026-11-09 · Trạng thái: chờ duyệt · Nối tiếp spec phần 1–3 (vẫn ràng buộc) · Nhánh `feat/part4` tách từ `feat/part3`

## 1. Mục tiêu

1. **Vào bên trong building:** bấm building khu vực → phòng của khu; bấm nhà trụ sở → văn phòng của phiên. Cảnh phòng thay cả khung bản đồ; người trong phòng bấm được, mở panel lịch sử có sẵn.
2. **Thành phố bớt "băng chuyền":** xe chạy ngẫu nhiên khắp mạng đường; thị trưởng/nhân viên đang làm đi lòng vòng gần cửa khu; thêm vài dân thường trang trí.

Thành công khi: vào/ra được mọi building, người trong phòng khớp với ngoài đường và cập nhật trực tiếp; xe và người nhìn không lặp lại theo một nhịp cố định.

## 2. Phạm vi

**Trong:** chỉ client (`src/client/*`), dữ liệu sẵn có (WebSocket state + `GET /api/session/:id`). Không đổi server, API, kiểu dữ liệu chung.

**Ngoài:** di chuyển nhân vật bằng bàn phím, vào phòng bằng cách đi bộ vào cửa, âm thanh, phòng trên/dưới nhiều tầng, xe tránh va chạm nhau, dân thường bấm được.

## 3. Hình ảnh

- Tải **Kenney Roguelike Indoors** (CC0, ô 16 px, cách 1 px — cùng series với hai bộ đang dùng) vào `assets/kenney/roguelike-indoors/`, ghi nguồn + giấy phép vào `assets/ASSETS.md`. Chỉ ảnh tilesheet + `License.txt` được commit.
- Chỉ số ô cụ thể (sàn, tường, bàn, ghế, máy tính, kệ sách, tủ máy chủ, cây…) được chọn trong kế hoạch sau khi xem tilesheet, khai báo hằng số trong `tiles.ts` như bộ city.
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
| `src/client/rooms.ts` (mới) | Bảng dữ liệu phòng theo khu; `roomOccupants(district, state)`; `officeLayout(detail)`; vẽ phòng (tiles hoặc khối màu) |
| `src/client/scene.ts` (mới) | Trạng thái cảnh `city` / `room(district)` / `office(sessionId)`; vào/ra; Esc theo lớp |
| `src/client/tiles.ts` | Nạp tilesheet indoors + hằng số chỉ số ô |
| `src/client/main.ts`, `hud.ts`, `index.html` | Bấm building/HQ → vào phòng; nút "← Về thành phố"; nối delta vào cảnh |
| `assets/kenney/roguelike-indoors/`, `assets/ASSETS.md` | Tilesheet + giấy phép |

## 7. Xử lý lỗi

| Trường hợp | Xử lý |
|---|---|
| Không tải được tilesheet indoors | Phòng vẽ khối màu, không lỗi |
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
- `scene`: vào/ra; Esc đóng đúng lớp trên cùng; phiên bị ẩn khi ở văn phòng → về thành phố.
- Text trên bảng/nhãn render bằng `textContent`/Text (không HTML).

**Thủ công:** vào từng khu và vài trụ sở, bấm người trong phòng mở đúng panel; ra/vào nhiều lần không rò sprite; xe đi khắp các đường và rẽ khác nhau; người làm việc lòng vòng gần cửa; bật giảm chuyển động → đứng yên.
