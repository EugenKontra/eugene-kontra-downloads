import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Creator Publish Hub", description: "Публикация видео в YouTube, TikTok и Instagram" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#09090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
