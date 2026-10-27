import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-reading",
});

export const metadata: Metadata = {
  title: "Shelfmark",
  description: "Save pages, find them again, and ask questions answered only from what you saved.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${publicSans.variable} ${sourceSerif.variable}`}>{children}</body>
    </html>
  );
}
