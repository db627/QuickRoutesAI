"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "./useScrollReveal";

const stats = [
  { value: "32%", label: "Faster deliveries" },
  { value: "2.5M+", label: "Routes optimized" },
  { value: "99.9%", label: "Platform uptime" },
  { value: "18min", label: "Avg. time saved per route" },
];

export default function StatsBar() {
  const { ref, isVisible } = useScrollReveal(0.2);

  return (
    <section className="relative bg-brand-900 py-16">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-900 via-indigo-900 to-brand-900" />
      <div className="pointer-events-none absolute inset-0 dot-pattern opacity-10" />

      <div
        ref={ref}
        className="relative mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 md:grid-cols-4"
      >
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 30 }}
            animate={isVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className="text-center"
          >
            <div className="text-3xl font-extrabold text-white sm:text-4xl">
              {stat.value}
            </div>
            <div className="mt-1.5 text-sm font-medium text-brand-200/70">
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
