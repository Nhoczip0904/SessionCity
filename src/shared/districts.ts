import type { District } from "./types.js";

export const DISTRICTS: { id: District; label: string }[] = [
  { id: "townhall", label: "Toà thị chính" },
  { id: "library", label: "Thư viện" },
  { id: "design", label: "Toà thiết kế" },
  { id: "site", label: "Công trường" },
  { id: "database", label: "Kho dữ liệu" },
  { id: "lab", label: "Phòng thí nghiệm" },
  { id: "review", label: "Toà review" },
  { id: "factory", label: "Nhà máy" },
  { id: "airport", label: "Sân bay" },
  { id: "watchtower", label: "Tháp canh" },
  { id: "home", label: "Khu dân cư" },
];
