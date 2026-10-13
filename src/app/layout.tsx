import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "TecnoID — Educational Center Management",
  description: "TecnoID: professional SaaS platform for educational and tutoring centers.",
  icons: { icon: "/logo.png" }
};

// Explicit viewport so every phone/tablet renders at its real device width
// (no desktop-scale zoom-out). Zooming is intentionally NOT disabled so users
// can still pinch-zoom for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" }
  ]
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
