import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { siteUrl } from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: "Deriv Bot | Automated Trading Tools & Market Intelligence",
  description: "Market intelligence, systematic strategy evaluation, configurable risk controls and trade monitoring for Deriv trading workflows.",
  applicationName: "Deriv Bot",
  keywords: ["Deriv bot", "Deriv automated trading", "Deriv trading software", "synthetic indices analysis", "automated trading tools", "trading risk management"],
  alternates: { canonical: siteUrl("/") },
  openGraph: { type: "website", siteName: "Deriv Bot", title: "Deriv Bot | Automated Trading Tools", description: "Market intelligence, systematic strategies and risk-aware execution workflows.", url: siteUrl("/"), images: [{ url: "/og-derivbot.png", width: 1200, height: 630, alt: "Deriv Bot trading intelligence platform" }] },
  twitter: { card: "summary_large_image", title: "Deriv Bot | Automated Trading Tools", description: "Market intelligence, systematic strategies and risk-aware execution workflows.", images: ["/og-derivbot.png"] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#020617] text-slate-100 selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
