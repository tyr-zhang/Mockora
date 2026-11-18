import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mockora · AI 模拟面试",
  description: "基于 OpenAI Agents SDK 的模拟面试智能体，支持学习模式与考试模式",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
