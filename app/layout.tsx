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
/**
 * Where the site is served from, so a shared link resolves its own card image.
 * `lib/env` validates NEXTAUTH_URL fail-closed at boot, so the fallback only
 * covers a local build run before that.
 */
function siteUrl(): URL {
    const configured = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    try {
        return new URL(configured);
    } catch {
        // Metadata is collected before `instrumentation.ts` runs, so `lib/env`
        // has not had its say yet and a bad value surfaces as `Invalid URL` in
        // a minified chunk, attributed to whichever route was being collected.
        // Name the variable instead.
        throw new Error(`NEXTAUTH_URL is not a valid URL: ${JSON.stringify(configured)}`);
    }
}

export const metadata: Metadata = {
    metadataBase: siteUrl(),
    title: {
        default: `${BRAND.name} — ${BRAND.tagline}`,
        template: `%s | ${BRAND.name}`,
    },
    description: BRAND.description,
    applicationName: BRAND.name,
    // The social card lives on `app/page.tsx`, not here. `metadataBase` is
    // resolved when a page renders, and the auth routes are prerendered — so a
    // card declared at the root baked the build machine's URL into every one of
    // them, which in a container image means `http://localhost:3000`. The home
    // page renders per request and is the link anyone actually shares (#140).
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
