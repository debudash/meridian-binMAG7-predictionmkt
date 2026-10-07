import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { Header, Footer } from "@/components/layout/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meridian — Yes/No stock outcomes",
  description:
    "Binary Yes/No markets on stock prices. Each contract pays 1.00 USDC if right at settlement.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <Header />
          <main style={{ minHeight: "70vh", padding: "1.5rem 0" }}>{children}</main>
          <Footer />
        </AppProviders>
      </body>
    </html>
  );
}
