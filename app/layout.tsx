import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import "./globals.css";

// Both have full Cyrillic; Geist was loaded latin-only, so Russian text fell back to a system font.
const onest = Onest({ variable: "--font-onest", subsets: ["latin", "cyrillic"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "WING Scene Generator",
  description: "Текст → сцена Behringer WING",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${onest.variable} ${jetbrains.variable}`}>
      <body
        className="antialiased"
      >
        {children}
      </body>
    </html>
  );
}
