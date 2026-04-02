"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, CheckCircle, Loader2, AlertCircle } from "lucide-react";

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Load the reCAPTCHA v3 script once. */
function loadRecaptchaScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById("recaptcha-v3")) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = "recaptcha-v3";
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load reCAPTCHA"));
    document.head.appendChild(script);
  });
}

/** Get a reCAPTCHA v3 token for an action. */
function getRecaptchaToken(action: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const g = (window as unknown as { grecaptcha: { ready: (cb: () => void) => void; execute: (key: string, opts: { action: string }) => Promise<string> } }).grecaptcha;
    if (!g) {
      reject(new Error("reCAPTCHA not loaded"));
      return;
    }
    g.ready(() => {
      g.execute(RECAPTCHA_SITE_KEY, { action })
        .then(resolve)
        .catch(reject);
    });
  });
}

interface QuoteModalProps {
  open: boolean;
  onClose: () => void;
}

export default function QuoteModal({ open, onClose }: QuoteModalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load reCAPTCHA script when modal opens
  useEffect(() => {
    if (open && RECAPTCHA_SITE_KEY) {
      loadRecaptchaScript().catch(() =>
        setError("Failed to load reCAPTCHA. Please refresh the page."),
      );
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      const form = e.currentTarget;
      const formData = new FormData(form);

      try {
        // Get reCAPTCHA token
        let recaptchaToken = "";
        if (RECAPTCHA_SITE_KEY) {
          recaptchaToken = await getRecaptchaToken("submit_quote");
        }

        const res = await fetch(`${API_URL}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            email: formData.get("email"),
            company: formData.get("company"),
            fleetSize: formData.get("fleetSize"),
            message: formData.get("message") || undefined,
            recaptchaToken,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            body?.message ?? "Something went wrong. Please try again.",
          );
        }

        setSubmitted(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setSubmitted(false);
      setError(null);
    }, 300);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={handleClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-brand-950/40 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            {!submitted ? (
              <div className="p-8">
                {/* Header */}
                <div className="mb-8">
                  <div className="mb-3 inline-flex rounded-2xl bg-brand-50 p-3">
                    <Send className="h-6 w-6 text-brand-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Request a Quote
                  </h2>
                  <p className="mt-1.5 text-sm text-gray-500">
                    Tell us about your fleet and we&apos;ll put together a
                    tailored proposal.
                  </p>
                </div>

                {/* Error banner */}
                {error && (
                  <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Full name
                      </label>
                      <input
                        required
                        name="name"
                        type="text"
                        placeholder="Jane Smith"
                        className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Business email
                      </label>
                      <input
                        required
                        name="email"
                        type="email"
                        placeholder="jane@company.com"
                        className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Company name
                    </label>
                    <input
                      required
                      name="company"
                      type="text"
                      placeholder="Acme Logistics"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-50"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Fleet size
                    </label>
                    <select
                      required
                      name="fleetSize"
                      className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 outline-none transition-all focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-50"
                    >
                      <option value="">Select fleet size</option>
                      <option value="1-10">1 - 10 vehicles</option>
                      <option value="11-50">11 - 50 vehicles</option>
                      <option value="51-200">51 - 200 vehicles</option>
                      <option value="200+">200+ vehicles</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Tell us more{" "}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                    </label>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="Describe your routing challenges, goals, or timeline..."
                      className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Submit Request
                        <Send className="h-4 w-4" />
                      </>
                    )}
                  </button>

                  {/* reCAPTCHA notice */}
                  <p className="text-center text-[11px] leading-relaxed text-gray-400">
                    Protected by reCAPTCHA.{" "}
                    <a
                      href="https://policies.google.com/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-500"
                    >
                      Privacy
                    </a>{" "}
                    &{" "}
                    <a
                      href="https://policies.google.com/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-500"
                    >
                      Terms
                    </a>{" "}
                    apply.
                  </p>
                </form>
              </div>
            ) : (
              /* Success state */
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center px-8 py-16 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 20,
                    delay: 0.1,
                  }}
                  className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-50"
                >
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </motion.div>
                <h3 className="text-xl font-bold text-gray-900">
                  Quote request sent!
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  Our team will review your details and get back to you within
                  24 hours with a tailored proposal.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-8 rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-700 transition-all hover:border-gray-300 hover:shadow-sm"
                >
                  Close
                </button>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
