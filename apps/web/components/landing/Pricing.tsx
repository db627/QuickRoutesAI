"use client";

import { motion } from "framer-motion";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { useScrollReveal } from "./useScrollReveal";

const plans = [
  {
    name: "Starter",
    description: "For small fleets getting started with route optimization.",
    price: "$99",
    period: "/mo",
    features: [
      "Up to 10 drivers",
      "Basic route optimization",
      "Live GPS tracking",
      "Email support",
      "Standard analytics",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Professional",
    description: "For growing operations that need advanced intelligence.",
    price: "$299",
    period: "/mo",
    features: [
      "Up to 50 drivers",
      "AI-powered route optimization",
      "Real-time dispatch automation",
      "Advanced analytics & reports",
      "Priority support",
      "Custom integrations",
      "Multi-stop optimization",
    ],
    cta: "Get Started",
    highlighted: true,
  },
  {
    name: "Enterprise",
    description: "Custom solutions for large-scale fleet operations.",
    price: "Custom",
    period: "",
    features: [
      "Unlimited drivers",
      "Dedicated account manager",
      "Custom AI model training",
      "SLA guarantees",
      "On-premise deployment option",
      "White-label available",
      "24/7 phone support",
      "API access & webhooks",
    ],
    cta: "Contact Sales",
    highlighted: false,
  },
];

function PricingCard({
  plan,
  index,
  onQuoteClick,
}: {
  plan: (typeof plans)[0];
  index: number;
  onQuoteClick: () => void;
}) {
  const { ref, isVisible } = useScrollReveal(0.1);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isVisible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className={`relative flex flex-col rounded-3xl p-8 ${
        plan.highlighted
          ? "gradient-border bg-white shadow-2xl shadow-brand-500/10 lg:scale-105"
          : "border border-gray-200 bg-white"
      }`}
    >
      {plan.highlighted && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-500 to-indigo-600 px-4 py-1 text-xs font-semibold text-white shadow-lg shadow-brand-500/25">
            <Sparkles className="h-3 w-3" />
            Most Popular
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
        <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
      </div>

      <div className="mb-8">
        <span className="text-4xl font-extrabold tracking-tight text-brand-900">
          {plan.price}
        </span>
        <span className="text-base text-gray-400">{plan.period}</span>
      </div>

      <ul className="mb-8 flex-1 space-y-3.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                plan.highlighted
                  ? "bg-brand-100 text-brand-600"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </div>
            <span className="text-sm text-gray-600">{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onQuoteClick}
        className={`group flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all active:scale-[0.98] ${
          plan.highlighted
            ? "bg-gradient-to-r from-brand-500 to-indigo-600 text-white shadow-lg shadow-brand-500/25 hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
            : "border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:shadow-md"
        }`}
      >
        {plan.cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </motion.div>
  );
}

export default function Pricing({
  onQuoteClick,
}: {
  onQuoteClick: () => void;
}) {
  const { ref: headerRef, isVisible: headerVisible } = useScrollReveal();

  return (
    <section
      id="pricing"
      className="relative overflow-hidden bg-white py-28 lg:py-36"
    >
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern bg-grid" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-indigo-50/50 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div ref={headerRef} className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={headerVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Pricing
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={headerVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl font-extrabold tracking-tight text-brand-900 sm:text-4xl"
          >
            Plans that{" "}
            <span className="text-gradient">scale with your fleet</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={headerVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-4 text-lg text-gray-500"
          >
            Start small and grow. Every plan includes core route optimization and
            live tracking.
          </motion.p>
        </div>

        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {plans.map((plan, i) => (
            <PricingCard
              key={plan.name}
              plan={plan}
              index={i}
              onQuoteClick={onQuoteClick}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
