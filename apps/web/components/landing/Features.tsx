"use client";

import { motion } from "framer-motion";
import {
  Route,
  MapPin,
  BarChart3,
  Truck,
  Shield,
  Clock,
} from "lucide-react";
import { useScrollReveal } from "./useScrollReveal";

const features = [
  {
    icon: Route,
    title: "AI Route Optimization",
    description:
      "Our algorithms analyze traffic, distance, and delivery windows to compute the most efficient routes in real time.",
    gradient: "from-blue-500 to-cyan-400",
    shadowColor: "shadow-blue-500/20",
  },
  {
    icon: MapPin,
    title: "Live Driver Tracking",
    description:
      "See every driver on a live map with real-time position updates, speed monitoring, and ETA calculations.",
    gradient: "from-indigo-500 to-blue-400",
    shadowColor: "shadow-indigo-500/20",
  },
  {
    icon: Truck,
    title: "Smart Dispatch",
    description:
      "Automatically assign trips to the best available driver based on proximity, capacity, and workload balance.",
    gradient: "from-violet-500 to-indigo-400",
    shadowColor: "shadow-violet-500/20",
  },
  {
    icon: BarChart3,
    title: "Analytics & Reports",
    description:
      "Deep insights into delivery performance, driver efficiency, fuel costs, and customer satisfaction metrics.",
    gradient: "from-purple-500 to-violet-400",
    shadowColor: "shadow-purple-500/20",
  },
  {
    icon: Clock,
    title: "Real-Time Alerts",
    description:
      "Instant notifications for delays, route deviations, completed deliveries, and critical operational events.",
    gradient: "from-sky-500 to-blue-400",
    shadowColor: "shadow-sky-500/20",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description:
      "Role-based access control, encrypted data in transit and at rest, and full audit trails for compliance.",
    gradient: "from-blue-600 to-indigo-500",
    shadowColor: "shadow-blue-600/20",
  },
];

function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof features)[0];
  index: number;
}) {
  const { ref, isVisible } = useScrollReveal(0.1);
  const Icon = feature.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isVisible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}
      className="group relative"
    >
      <div className="relative h-full rounded-2xl border border-gray-100 bg-white p-8 transition-all duration-300 hover:border-gray-200 hover:shadow-xl hover:shadow-gray-200/50 hover:-translate-y-1">
        {/* Icon */}
        <div
          className={`mb-5 inline-flex rounded-2xl bg-gradient-to-br ${feature.gradient} p-3.5 shadow-lg ${feature.shadowColor}`}
        >
          <Icon className="h-6 w-6 text-white" strokeWidth={2} />
        </div>

        <h3 className="mb-3 text-lg font-bold text-gray-900">
          {feature.title}
        </h3>

        <p className="text-[15px] leading-relaxed text-gray-500">
          {feature.description}
        </p>

        {/* Subtle hover gradient */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-50/0 to-indigo-50/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:from-brand-50/50 group-hover:to-indigo-50/30" />
      </div>
    </motion.div>
  );
}

export default function Features() {
  const { ref: headerRef, isVisible: headerVisible } = useScrollReveal();

  return (
    <section
      id="features"
      className="relative overflow-hidden bg-gray-50/50 py-28 lg:py-36"
    >
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 dot-pattern opacity-40" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-brand-100/30 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div ref={headerRef} className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={headerVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Features
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={headerVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl font-extrabold tracking-tight text-brand-900 sm:text-4xl"
          >
            Everything you need to{" "}
            <span className="text-gradient">optimize delivery operations</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={headerVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-4 text-lg text-gray-500"
          >
            Powerful tools designed for logistics teams that demand efficiency,
            visibility, and control.
          </motion.p>
        </div>

        {/* Feature grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <FeatureCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
