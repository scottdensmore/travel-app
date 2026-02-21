import React from "react";
import "./globals.css";
import TitleBar from "@/components/ui/titlebar";
import Footer from "@/components/ui/footer";
import { Providers } from "@/components/providers";

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
