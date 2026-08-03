import React from "react";
import type { Metadata } from "next";
import "./globals.css";
import TitleBar from "@/components/ui/titlebar";
import Footer from "@/components/ui/footer";
import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";

/**
 * Every route inherits the name and gets its own title through the template, so
 * no page can ship as the bare product name or as "Authentication" (#72).
 */
export const metadata: Metadata = {
    title: {
        default: `${BRAND.name} — ${BRAND.tagline}`,
        template: `%s | ${BRAND.name}`,
    },
    description: BRAND.description,
    applicationName: BRAND.name,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TitleBar />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
