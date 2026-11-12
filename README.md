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
- **Mở phiên mới.** Chọn thư mục, model và nhập yêu cầu, app sẽ mở `claude` trong Windows Terminal. Cũng có thể mở terminal hoặc ô chat của một phiên ngay trong app.
- **Quảng trường giải trí.** Treo ảnh lên thánh giá giữa quảng trường rồi chọi đá. Bật/tắt và đổi ảnh từ thanh công cụ.

## Yêu cầu

- Windows 10/11. Phần mở phiên dùng Windows Terminal (`wt`) và `claude.exe`.
- Node.js 20 trở lên.
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

## Bảo mật

- Server chỉ nghe trên `127.0.0.1`. Mọi API và WebSocket đều cần token ngẫu nhiên in ra lúc khởi động.
- App chỉ **đọc** nhật ký Claude Code, không sửa phiên đang chạy. Ngoài file tạm lúc mở phiên mới, app chỉ ghi file agent `Explore.md` trong `~/.claude/agents/` khi bạn bật tuỳ chọn đó. File bạn tự viết thì không bị đụng tới.

## Công nghệ

- Server: Node.js, TypeScript, `node:http`, `ws`, `node-pty`.
- Client: Vite, PixiJS v8, xterm.js.
- Test: Vitest, happy-dom.

## Đồ hoạ

Tile và nhân vật lấy từ bộ pixel CC0 của [Kenney](https://kenney.nl), chi tiết trong [ASSETS.md](ASSETS.md).
