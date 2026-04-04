"use client";

import { motion } from "framer-motion";

/**
 * Animated SVG illustration for the hero section — a network of route nodes
 * connected by animated paths, representing AI-powered route optimization.
 */
export default function HeroVisual() {
  const nodes = [
    { x: 200, y: 80, delay: 0, label: "A" },
    { x: 380, y: 140, delay: 0.2, label: "B" },
    { x: 120, y: 240, delay: 0.4, label: "C" },
    { x: 320, y: 280, delay: 0.3, label: "D" },
    { x: 460, y: 260, delay: 0.5, label: "E" },
    { x: 240, y: 380, delay: 0.6, label: "F" },
    { x: 420, y: 380, delay: 0.7, label: "G" },
  ];

  const paths = [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 3 },
    { from: 1, to: 4 },
    { from: 2, to: 3 },
    { from: 2, to: 5 },
    { from: 3, to: 5 },
    { from: 3, to: 6 },
    { from: 4, to: 6 },
    { from: 5, to: 6 },
  ];

  const optimalPath = [0, 1, 3, 5, 6, 4];

  const optimalEdges = optimalPath.slice(0, -1).map((from, i) => ({
    from,
    to: optimalPath[i + 1],
  }));

  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className="absolute inset-0 rounded-3xl bg-radial-glow opacity-60" />

      <svg
        viewBox="0 0 560 460"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative w-full"
      >
        {/* Grid dots background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="1" fill="rgba(59,130,246,0.15)" />
          </pattern>
          <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width="560" height="460" fill="url(#grid)" rx="24" />

        {/* Non-optimal paths (faded) */}
        {paths.map((p, i) => {
          const from = nodes[p.from];
          const to = nodes[p.to];
          const isOptimal = optimalEdges.some(
            (e) =>
              (e.from === p.from && e.to === p.to) ||
              (e.from === p.to && e.to === p.from),
          );
          if (isOptimal) return null;
          return (
            <motion.line
              key={`path-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(59,130,246,0.12)"
              strokeWidth="2"
              strokeDasharray="6 6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.5 }}
            />
          );
        })}

        {/* Optimal path (animated) */}
        {optimalEdges.map((p, i) => {
          const from = nodes[p.from];
          const to = nodes[p.to];
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          return (
            <motion.line
              key={`optimal-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="url(#routeGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              filter="url(#glow)"
              strokeDasharray={length}
              strokeDashoffset={length}
              animate={{ strokeDashoffset: 0 }}
              transition={{
                delay: 1 + i * 0.25,
                duration: 0.6,
                ease: "easeOut",
              }}
            />
          );
        })}

        {/* Animated dot traveling the path */}
        <motion.circle
          r="5"
          fill="#3b82f6"
          filter="url(#glow)"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 1, 1, 1, 1, 1, 0],
            cx: optimalPath.map((i) => nodes[i].x),
            cy: optimalPath.map((i) => nodes[i].y),
          }}
          transition={{
            delay: 2.5,
            duration: 3,
            ease: "easeInOut",
            repeat: Infinity,
            repeatDelay: 1.5,
          }}
        />

        {/* Nodes */}
        {nodes.map((node, i) => (
          <motion.g
            key={`node-${i}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              delay: 0.3 + node.delay,
              type: "spring",
              stiffness: 300,
              damping: 20,
            }}
          >
            {/* Pulse ring for optimal path nodes */}
            {optimalPath.includes(i) && (
              <motion.circle
                cx={node.x}
                cy={node.y}
                r="22"
                fill="none"
                stroke="rgba(59,130,246,0.3)"
                strokeWidth="1"
                animate={{
                  r: [22, 30],
                  opacity: [0.6, 0],
                }}
                transition={{
                  delay: 2 + node.delay,
                  duration: 1.5,
                  repeat: Infinity,
                  repeatDelay: 2,
                }}
              />
            )}
            <circle
              cx={node.x}
              cy={node.y}
              r="20"
              fill={optimalPath.includes(i) ? "white" : "rgba(255,255,255,0.6)"}
              stroke={optimalPath.includes(i) ? "#3b82f6" : "rgba(59,130,246,0.2)"}
              strokeWidth={optimalPath.includes(i) ? 2.5 : 1.5}
            />
            <text
              x={node.x}
              y={node.y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-xs font-bold"
              fill={optimalPath.includes(i) ? "#2563eb" : "#94a3b8"}
            >
              {node.label}
            </text>
          </motion.g>
        ))}
      </svg>

      {/* Floating badge */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 3, duration: 0.5 }}
        className="absolute -right-4 bottom-12 rounded-2xl bg-white/90 px-4 py-3 shadow-xl shadow-black/5 backdrop-blur-sm md:-right-8"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-green-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Route optimized</p>
            <p className="text-sm font-bold text-gray-900">
              32% faster <span className="text-green-500">&#8593;</span>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
