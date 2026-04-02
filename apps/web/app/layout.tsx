import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";

export const metadata: Metadata = {
  title: "QuickRoutesAI — AI-Powered Route Optimization",
  description:
    "Optimize your fleet operations with real-time route intelligence, live driver tracking, and AI-driven dispatch. Smarter routes, faster deliveries, less overhead.",
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
