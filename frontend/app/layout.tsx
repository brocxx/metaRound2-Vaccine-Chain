import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { ReactiveCursor } from "@/components/hero/ReactiveCursor";
import { SmoothScrollProvider } from "@/components/chrome/SmoothScrollProvider";

import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vaccine Cold Chain // Mission Control",
  description:
    "An OpenEnv environment where an AI agent manages a 3-node vaccine cold chain over 72 hours. Mission control for the impossible delivery.",
  metadataBase: new URL("http://localhost:3000"),
  openGraph: {
    title: "Vaccine Cold Chain // Mission Control",
    description:
      "Watch an LLM keep vaccines alive across 72 simulated hours. 3 nodes. 1 agent. 1 truck. 1 lying sensor.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--bg-base)] text-[var(--ink-primary)]">
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
        <ReactiveCursor />
      </body>
    </html>
  );
}
