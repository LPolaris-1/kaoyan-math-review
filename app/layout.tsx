import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "考研数学 · 错题复盘",
  description: "按日期浏览考研数学错题，形成每日复盘闭环。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
