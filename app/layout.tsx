import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Velodrome Position Monitor · Worker POC",
  description: "Read-only fixture dashboard served by a ChatGPT Sites Worker.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
