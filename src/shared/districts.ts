import type { District } from "./types.js";

export interface DistrictInfo {
  id: District;
  label: string;
  sign: string;
  description: string;
  examples: string[];
}

export const DISTRICTS: DistrictInfo[] = [
  { id: "townhall", label: "Toà thị chính", sign: "Chờ bạn", description: "Thị trưởng nhận yêu cầu hoặc đang chờ bạn trả lời.", examples: ["Claude kết thúc lượt, chờ bạn trả lời"] },
  { id: "library", label: "Thư viện", sign: "Khảo sát code", description: "Đọc và tìm kiếm trong code, tài liệu, web trước khi làm.", examples: ["Read", "Grep", "Glob", "WebSearch"] },
  { id: "design", label: "Toà thiết kế", sign: "Thiết kế & kế hoạch", description: "Viết spec, kế hoạch, todo cho tính năng.", examples: ["TodoWrite", "Plan mode", "sửa docs/**", "*.md"] },
  { id: "site", label: "Công trường", sign: "Viết code", description: "Sửa và tạo file mã nguồn.", examples: ["Edit", "Write"] },
  { id: "database", label: "Kho dữ liệu", sign: "Migration DB", description: "Thay đổi schema, chạy migration, truy vấn DB.", examples: ["dotnet ef", "prisma", "*.sql", "Migrations/"] },
  { id: "lab", label: "Phòng thí nghiệm", sign: "Chạy test", description: "Chạy bộ test và đọc kết quả.", examples: ["dotnet test", "npm test", "pytest"] },
  { id: "review", label: "Toà review", sign: "Review & Git", description: "Xem diff, commit, mở/duyệt PR.", examples: ["git diff", "git commit", "gh pr"] },
  { id: "factory", label: "Nhà máy", sign: "Build / CI", description: "Biên dịch, đóng gói, chạy CI.", examples: ["dotnet build", "npm run build", "docker build"] },
  { id: "airport", label: "Sân bay", sign: "Deploy", description: "Đẩy code, triển khai môi trường.", examples: ["git push", "docker push", "kubectl apply"] },
  { id: "watchtower", label: "Tháp canh", sign: "Giám sát", description: "Xem log, kiểm tra sức khoẻ dịch vụ.", examples: ["docker logs", "kubectl logs", "curl …/health"] },
  { id: "home", label: "Khu dân cư", sign: "Nghỉ", description: "Phiên không hoạt động quá 10 phút.", examples: [] },
];

export const districtInfo = (id: District): DistrictInfo => DISTRICTS.find((d) => d.id === id)!;
