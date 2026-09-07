import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono, Lora, Sora, Space_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * The typefaces a tenant's theme can choose between.
 *
 * `theme.type.fontBody` and `fontDisplay` name one of these; lib/config/theme.ts
 * maps the name onto the variable each one declares here. They are loaded
 * through next/font, which self-hosts and inlines the font-face rules at build
 * time — so a theme change is instant, there is no flash of unstyled text, and
 * no request leaves for Google at runtime.
 *
 * Adding one is a product decision, not a config edit: every extra family is
 * weight on every page load. Six covers dense tool, editorial, technical and
 * literary without overlapping.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const FONT_VARIABLES = [inter, sora, spaceGrotesk, fraunces, lora, jetbrainsMono]
  .map((font) => font.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "CRM",
  description: "A CRM you configure by talking to it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={FONT_VARIABLES}>
      <body>{children}</body>
    </html>
  );
}
