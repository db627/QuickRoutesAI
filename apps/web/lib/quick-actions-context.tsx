"use client";

import { createContext, useContext, useState } from "react";

interface QuickActionsContextValue {
  showTripForm: boolean;
  openNewTrip: () => void;
  closeNewTrip: () => void;
  showMultiOptimizer: boolean;
  openMultiOptimizer: () => void;
  closeMultiOptimizer: () => void;
}

const QuickActionsContext = createContext<QuickActionsContextValue | null>(null);

export function QuickActionsProvider({ children }: { children: React.ReactNode }) {
  const [showTripForm, setShowTripForm] = useState(false);
  const [showMultiOptimizer, setShowMultiOptimizer] = useState(false);

  const openNewTrip = () => {
    setShowTripForm(true);
    setShowMultiOptimizer(false);
  };

  const openMultiOptimizer = () => {
    setShowMultiOptimizer(true);
    setShowTripForm(false);
  };

  return (
    <QuickActionsContext.Provider
      value={{
        showTripForm,
        openNewTrip,
        closeNewTrip: () => setShowTripForm(false),
        showMultiOptimizer,
        openMultiOptimizer,
        closeMultiOptimizer: () => setShowMultiOptimizer(false),
      }}
    >
      {children}
    </QuickActionsContext.Provider>
  );
}

export function useQuickActions() {
  const ctx = useContext(QuickActionsContext);
  if (!ctx) throw new Error("useQuickActions must be used within QuickActionsProvider");
  return ctx;
}
