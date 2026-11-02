import type { Metadata, Viewport } from "next";
import "./globals.css";

// Every page is rendered per request: needed for the CSP nonce and for per-user data.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "School Platform", template: "%s · School Platform" },
  description: "School management for Zimbabwean high schools",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f6f5c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
