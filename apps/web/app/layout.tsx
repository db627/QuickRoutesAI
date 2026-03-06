import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";

export const metadata: Metadata = {
  title: "QuickRoutesAI — Dispatcher Dashboard",
  description: "AI-powered route optimization for delivery operations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
