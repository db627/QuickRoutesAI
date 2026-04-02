"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useScrollReveal } from "./useScrollReveal";

export default function CTA({ onQuoteClick }: { onQuoteClick: () => void }) {
  const { ref, isVisible } = useScrollReveal(0.2);

  return (
    <section id="quote" className="relative overflow-hidden bg-gray-50 py-28 lg:py-36">
      <div className="pointer-events-none absolute inset-0 dot-pattern opacity-30" />

      <div ref={ref} className="relative mx-auto max-w-4xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="rounded-3xl bg-gradient-to-br from-brand-900 via-indigo-900 to-brand-800 p-12 shadow-2xl shadow-brand-900/20 md:p-16"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
            <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-brand-500/20 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-indigo-500/20 blur-3xl" />
          </div>

          <div className="relative">
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
              Ready to optimize your fleet?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-brand-200/70">
              Get a custom quote tailored to your fleet size and delivery
              requirements. Our team responds within 24 hours.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                onClick={onQuoteClick}
                className="group flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-semibold text-brand-900 shadow-xl transition-all hover:shadow-2xl hover:brightness-95 active:scale-[0.98]"
              >
                Request a Quote
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
              <a
                href="#pricing"
                className="rounded-2xl border border-white/20 px-8 py-4 text-base font-semibold text-white transition-all hover:border-white/40 hover:bg-white/10"
              >
                View Pricing
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
