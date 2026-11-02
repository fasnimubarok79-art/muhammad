import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/use-toast";
import { SessionProvider } from "@/components/app/session";

export const metadata: Metadata = {
  title: "ClipKita · cut long videos into short clips",
  description: "Upload a video, get transcript-based clip candidates with synced subtitles, edit them, and render 1080×1920 MP4s.",
};
export const viewport: Viewport = { themeColor: "#0B0F19", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
