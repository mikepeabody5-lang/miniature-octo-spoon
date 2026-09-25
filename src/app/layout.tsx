import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Equitize",
  description: "Launch a coin on a Meteora bonding curve.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
