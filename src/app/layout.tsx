import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gemini Live API Avatar Demo - Mascot Bot SDK",
  description: "Open-source example demonstrating Gemini Live API integration with Mascot Bot SDK for real-time animated avatars with lip sync",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
