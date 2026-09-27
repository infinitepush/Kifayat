import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kifayat — LLM Token & Cost Optimization Engine",
  description:
    "A proxy layer that cuts LLM token usage and proves it didn't sacrifice answer quality. Compare naive vs optimized prompts with live before/after metrics.",
  keywords: [
    "LLM optimization",
    "token reduction",
    "cost optimization",
    "AI proxy",
    "prompt optimization",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
