import type { Metadata } from "next";
import { siteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Trading Terminal",
  alternates: { canonical: siteUrl("/terminal") },
  robots: { index: false, follow: false, noarchive: true },
};

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
