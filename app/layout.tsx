import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tradmiles-final.vercel.app"),
  title: {
    default: "TradeMiles",
    template: "%s · TradeMiles",
  },
  description: "Painel de gestão de milhas, compras e emissões.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  openGraph: {
    type: "website",
    url: "https://tradmiles-final.vercel.app",
    title: "TradeMiles",
    description: "Painel de gestão de milhas, compras e emissões.",
    siteName: "TradeMiles",
  },
  themeColor: "#000000",
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen flex flex-col">
          <main className="flex-1">{children}</main>

          {/* Rodapé global */}
          <footer className="py-4 text-center text-xs text-neutral-500">
            Desenvolvido por <strong>Dr. Jephesson Santos</strong>
          </footer>
        </div>
      </body>
    </html>
  );
}
