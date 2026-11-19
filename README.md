# SessionCity

Một thành phố pixel chạy trên trình duyệt, cho bạn nhìn các phiên **Claude Code** trên máy đang làm gì.

Mỗi phiên là một **thị trưởng** đi lại giữa các khu theo việc đang làm. Các subagent là **nhân viên** đi theo thị trưởng.

## Tính năng

- **Theo dõi thời gian thực.** App đọc nhật ký trong `~/.claude/projects/` và cập nhật qua WebSocket, chậm khoảng 2 giây sau mỗi lệnh công cụ. Không cần API key, không sửa gì vào phiên.
- **Các khu theo giai đoạn làm việc:**
  - Thư viện (đọc code)
  - Toà thiết kế (spec, kế hoạch)
  - Công trường (viết code)
  - Kho dữ liệu (migration)
  - Phòng thí nghiệm (test)
  - Toà review (git, PR)
  - Nhà máy (build)
  - Sân bay (deploy)
  - Tháp canh (log)
  - Toà thị chính (chờ bạn)
  - Khu dân cư (nghỉ)

  Quy tắc phân khu nằm trong [`config/districts.json`](config/districts.json).
- **Xem chi tiết.** Bấm vào thị trưởng hoặc nhân viên để xem:
  - lời giao việc;
  - các bước đã làm;
  - báo cáo trả về;
  - token đã dùng.
- **Bên trong toà nhà.** Mỗi khu có phòng riêng, bấm vào đồ đạc để mở:
  - két token;
  - tủ hồ sơ báo cáo;
  - kệ `CLAUDE.md` và skill;
  - điện thoại để mở phiên mới.
- **Bảng PR ở toà review.** Hiện PR đang mở của các repo mà các phiên đang làm, kèm người tạo, trạng thái review và CI. Cần [GitHub CLI](https://cli.github.com/) đã đăng nhập.
- **Cột agent bên trái.** Mỗi agent là một ô có avatar. Subagent xổ ra khi bấm `+N`.
- **Mở phiên mới.** Chọn thư mục, model và nhập yêu cầu, app sẽ mở `claude` trong Windows Terminal. Cũng có thể mở terminal của một phiên ngay trong app.
- **Chat nổi.** Mỗi phiên mở được một cửa sổ chat riêng, kéo và đổi cỡ tự do, mở nhiều cửa sổ cùng lúc.
  - Lịch sử lấy từ nhật ký phiên, tin nhắn gửi từ cửa sổ khác cũng hiện theo.
  - Hiện chỉ báo đang làm việc, xem diff, terminal và danh sách việc của công cụ.
  - Tin gõ lúc Claude đang trả lời được xếp hàng chờ tới lượt.
  - Câu hỏi xin quyền của phiên hiện ngay trong chat; phiên đang chờ quyền được tính là "chờ bạn".
  - Nút `>_` và 📁 mở console hoặc thư mục của phiên.
- **Menu phiên bên cạnh chat.** Liệt kê phiên theo thư mục, kèm avatar.
  - Bấm một phiên để chuyển, hoặc kéo nó thả lên một cửa sổ chat để thay vào đó.
  - Phiên đang mở chat có viền cam.
  - Nút × ẩn bớt phiên (lưu trong trình duyệt), "Hiện N đã ẩn" để xem lại.
- **Ghi chú.** Nút 📌 Ghi chú dán giấy lên màn hình (tài khoản test, việc cần nhớ).
  - Lưu ở `~/.sessioncity/notes.json`, có thể sửa tay, màn hình tự cập nhật sau vài giây.
  - Mỗi note có cờ `pinned`: chỉ note đã ghim hiện trên màn hình, nút ☰ liệt kê tất cả để ghim hoặc bỏ ghim.
  - Nắm biểu tượng ✉ ở góc trên trái của tờ giấy, kéo thả vào khung chat để chèn nội dung vào ô nhập.
- **Tóm tắt.** Nút 📋 cho biết hôm nay đã làm gì và còn gì dang dở.
- **Công viên giải trí.** Công viên dưới thành phố luôn có sẵn để chọi đá.

## Yêu cầu

- Windows 10/11. Phần mở phiên dùng Windows Terminal (`wt`) và `claude.exe`.
- Node.js 20 trở lên (dự án đang phát triển trên Node 24).
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code), có thì mới mở được phiên mới.
- GitHub CLI `gh`. Không bắt buộc, chỉ cần cho bảng PR.

## Chạy

```bash
npm install
npm run build
npm start
```

Server in ra một địa chỉ dạng `http://127.0.0.1:4317/?token=…`. Mở đúng địa chỉ đó trong trình duyệt.

Token đổi sau mỗi lần khởi động lại server. Muốn đổi cổng thì dùng `npm start -- --port 5000`.

Khi phát triển, chạy hai lệnh này ở hai terminal:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Chạy test:

```bash
npm test
```

## Hướng dẫn sử dụng

### 1. Bắt đầu

1. Chạy `npm install`, `npm run build`, `npm start` (xem phần [Chạy](#chạy)).
2. Mở đúng địa chỉ `http://127.0.0.1:4317/?token=…` mà server in ra. Mở thiếu `token` thì mọi thứ bị từ chối.
3. Chấm tròn ở góc phải thanh trên cùng cho biết kết nối. Nếu không hết "đang kết nối", kiểm tra server còn chạy không. Server khởi động lại thì token đổi, phải mở lại địa chỉ mới.

Phiên chỉ hiện trong thành phố nếu có hoạt động trong 7 ngày gần nhất. Sau 10 phút không có gì mới, phiên chuyển sang "nghỉ" và về khu dân cư.

### 2. Đọc màn hình thành phố

- Thanh trên cùng đếm số phiên **Đang làm**, **Chờ bạn**, **Nghỉ** và số phiên đã xong hôm nay.
- Mỗi thị trưởng đi tới khu tương ứng với việc phiên đang làm (đọc code đến thư viện, chạy test đến phòng thí nghiệm, v.v.).
- Phiên đang chờ bạn trả lời hoặc cấp quyền đứng ở toà thị chính.
- Rê chuột lên một nhân vật để xem tên và trạng thái, bấm để mở bảng chi tiết (lời giao việc, các bước, báo cáo, token).
- Bấm vào một toà nhà để vào bên trong. Nút **← Về thành phố** ở thanh trên cùng đưa bạn ra.
- Cột **Agent** bên trái liệt kê mọi phiên; bấm `+N` để xổ subagent. Nút **☰ Agent** ẩn hoặc hiện cột này.

### 3. Mở một phiên mới

1. Bấm **+ Mở phiên**.
2. Chọn thư mục (hoặc nhập đường dẫn), chọn model, gõ yêu cầu đầu tiên.
3. App mở `claude` trong Windows Terminal. Phiên mới hiện trong thành phố sau vài giây.

Nút **Quy tắc model** quy định model nào dùng cho loại việc nào. Quy tắc chỉ áp dụng cho phiên mở sau khi bật, phiên đang chạy giữ cấu hình cũ.

### 4. Chat với một phiên

Bấm **💬 Chat** (hoặc mở từ bảng chi tiết của một phiên) để mở cửa sổ chat.

| Việc | Cách làm |
| --- | --- |
| Gửi tin | Gõ rồi nhấn `Enter`. `Shift+Enter` xuống dòng. |
| Gõ lại tin cũ | `↑` / `↓` khi con trỏ ở đầu hoặc cuối ô nhập. |
| Dừng Claude đang trả lời | `Esc` (cửa sổ chat gần nhất trả lời nếu bạn bấm ngoài khung). |
| Gửi khi Claude đang bận | Cứ gõ và gửi, tin được xếp hàng và chạy tới lượt. |
| Đính kèm ảnh | Nút `+` ở góc trái ô nhập. Bấm × trên ảnh nhỏ để bỏ. |
| Đổi model | Danh sách model ở chân cửa sổ. |
| Đổi chế độ quyền | Danh sách chế độ ở chân cửa sổ, xem bên dưới. |
| Xem mức ngữ cảnh đã dùng | Thanh nhỏ ở chân cửa sổ, đỏ khi gần đầy. |
| Mở console / thư mục của phiên | Nút `>_` và 📁 trên thanh tiêu đề. |
| Dời, đổi cỡ cửa sổ | Kéo thanh tiêu đề, kéo cạnh. Vị trí được nhớ cho từng phiên. |
| Mở nhiều chat cùng lúc | Mở thêm phiên khác từ menu bên cạnh. |

**Chế độ quyền** quyết định khi nào Claude được hỏi bạn:

- **Hỏi trước:** hỏi mỗi lần sửa file hay chạy lệnh.
- **Tự sửa file:** tự sửa file, vẫn hỏi với lệnh shell.
- **Lập kế hoạch:** chỉ lập kế hoạch, không sửa gì.
- **Tự động:** hỏi ít nhất.

Khi Claude cần quyền hoặc hỏi lại bạn, câu hỏi hiện ngay trong chat và phiên đó được tính là "chờ bạn".

Nếu bạn gõ vào cùng phiên từ cửa sổ khác (Claude Desktop, terminal), tin đó cũng hiện trong chat của thành phố, nhưng chỉ tới khi phiên được ghi vào nhật ký, nên có thể chậm một nhịp.

### 5. Menu phiên bên cạnh chat

Cột bên phải của khung chat liệt kê các phiên theo thư mục.

- Bấm một dòng để chuyển chat sang phiên đó.
- Kéo một dòng thả lên một cửa sổ chat để thay phiên của cửa sổ đó.
- Dòng có **viền cam** là phiên đang mở chat.
- Rê chuột vào dòng rồi bấm **×** để ẩn phiên. Bấm **Hiện N đã ẩn** ở cuối menu để xem lại, bấm **↩** để bỏ ẩn. Danh sách ẩn lưu trong trình duyệt, không ảnh hưởng gì tới phiên thật.

### 6. Ghi chú dán giấy

1. Bấm **📌 Ghi chú** để dán một tờ giấy mới lên màn hình, rồi gõ nội dung.
2. Kéo thanh trên cùng của tờ giấy để dời nó.
3. **Gửi nội dung vào chat:** kéo cả tờ giấy thả lên bất kỳ chỗ nào của cửa sổ chat. Nội dung được chèn vào cuối ô nhập, chưa gửi cho tới khi bạn nhấn `Enter`.
4. **Ghim:** nút 📌 trên tờ giấy bỏ ghim (tờ giấy biến khỏi màn hình nhưng vẫn còn). Nút **☰** cạnh **📌 Ghi chú** mở danh sách mọi note để ghim lại (📍) hoặc xoá (×).
5. Xoá note có nội dung sẽ hỏi lại, note trống thì xoá luôn.

Ghi chú lưu ở `~/.sessioncity/notes.json` và là file JSON bạn có thể sửa tay:

```json
[
  { "id": "abc", "x": 900, "y": 60, "color": "#fff59d", "text": "admin@test / Abc123", "pinned": true }
]
```

- `id` là chuỗi duy nhất (tối đa 64 ký tự), `x`/`y` là toạ độ pixel trên màn hình, `text` tối đa 5000 ký tự.
- `color` là một trong `#fff59d`, `#ffcc80`, `#f8bbd0`, `#b3e5fc`, `#c5e1a5`; giá trị khác sẽ thành màu đầu tiên.
- `pinned` bỏ trống thì coi như `true`. Chỉ `false` mới ẩn tờ giấy khỏi màn hình.
- Tối đa 100 note. Mục nào sai dạng sẽ bị bỏ khi app đọc lại.
- Màn hình đọc lại file mỗi 5 giây, trừ lúc bạn đang gõ trong một tờ giấy. Xoá sạch file về `[]` bằng tay thì cần tải lại trang.

> Đừng để mật khẩu thật trong ghi chú. File này là văn bản thường trên máy bạn.

### 7. Bảng PR và tóm tắt

- Vào **toà review** để xem bảng PR đang mở của các repo mà phiên đang làm. Cần `gh auth login` trước.
- **📋 Tóm tắt** cho biết hôm nay đã làm gì và còn gì dang dở.

### 8. Công viên và trò chơi

- Menu **🎯 Trò chơi** chọn một trò rồi bấm lên bản đồ: **🪨 Chọi đá** (đá người đi đường, đá trúng toà nhà thì nổ rồi được dựng lại), **🤸 Ném người** (kéo một người lên rồi thả tay), **⚡ Sét đánh** (sét đánh xuống chỗ bấm). Bấm lại nút để tắt.

### 9. Xử lý sự cố

| Triệu chứng | Cách xử lý |
| --- | --- |
| Trang trống hoặc báo từ chối | Mở lại đúng địa chỉ có `?token=` mà server vừa in ra. |
| Sửa code server nhưng không thấy đổi | `npm run build` rồi khởi động lại server. Server phục vụ file trong `dist/client`. |
| Không thấy phiên nào | Phiên cũ hơn 7 ngày bị ẩn. Kiểm tra `~/.claude/projects/` có nhật ký mới không. |
| Chat hiện lịch sử cũ sau khi khởi động lại | Cập nhật lên bản mới, bản này chọn đúng bản sao nhật ký mới nhất của phiên. |
| Bảng PR trống | Cài `gh` và chạy `gh auth login`. |
| Nút mở phiên không mở được | Cần Windows Terminal (`wt`) và `claude` có trong `PATH`. |
| Bỏ ghim rồi tờ giấy ghim lại | Server cũ chưa biết cờ `pinned`. Build và khởi động lại server. |

## Bảo mật

- Server chỉ nghe trên `127.0.0.1`. Mọi API và WebSocket đều cần token ngẫu nhiên in ra lúc khởi động.
- App chỉ **đọc** nhật ký Claude Code, không sửa phiên đang chạy. Ngoài file tạm lúc mở phiên mới, app chỉ ghi file agent `Explore.md` trong `~/.claude/agents/` khi bạn bật tuỳ chọn đó (file bạn tự viết thì không bị đụng tới) và file ghi chú `~/.sessioncity/notes.json`. Phiên chỉ hiện trong thành phố nếu có hoạt động trong 7 ngày gần nhất.

## Công nghệ

- Server: Node.js, TypeScript, `node:http`, `ws`, `node-pty`.
- Client: Vite, PixiJS v8, xterm.js.
- Test: Vitest, happy-dom.

## Đồ hoạ

Tile và nhân vật lấy từ bộ pixel CC0 của [Kenney](https://kenney.nl), chi tiết trong [ASSETS.md](ASSETS.md).
