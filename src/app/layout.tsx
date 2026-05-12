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
  title: "CRM Odontológico",
  description: "Sistema de gestão de leads para clínicas odontológicas",
};

// `suppressHydrationWarning` no <body> evita warnings de hidratacao causados
// por extensoes de browser que injetam atributos antes do React hidratar
// (ex.: ColorZilla insere `cz-shortcut-listen`; Grammarly insere
// `data-gr-ext-installed`; etc). O escopo da flag e apenas ATRIBUTOS deste
// elemento — desvios reais em filhos continuam sendo reportados.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full bg-gray-50 font-sans"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
