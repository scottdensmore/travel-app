import "./globals.css";
import TitleBar from "@/components/ui/titlebar";
import Footer from "@/components/ui/footer";

export default function RootLayout({

  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <body>
        <TitleBar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
