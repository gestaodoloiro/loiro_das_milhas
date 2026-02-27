import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const APP_NAME = "Gestão do Loiro";

function resolveMetadataBase() {
  const fallback = "https://loiro-das-milhas.vercel.app";
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || fallback;
  try {
    return new URL(raw);
  } catch {
    return new URL(fallback);
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: "Painel de gestão de milhas, compras e emissões.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  openGraph: {
    type: "website",
    url: resolveMetadataBase().toString(),
    title: APP_NAME,
    description: "Painel de gestão de milhas, compras e emissões.",
    siteName: APP_NAME,
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
