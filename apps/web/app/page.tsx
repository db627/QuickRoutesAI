"use client";

import { useState } from "react";
import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import StatsBar from "@/components/landing/StatsBar";
import Features from "@/components/landing/Features";
import Pricing from "@/components/landing/Pricing";
import CTA from "@/components/landing/CTA";
import Footer from "@/components/landing/Footer";
import QuoteModal from "@/components/landing/QuoteModal";

export default function LandingPage() {
  const [quoteOpen, setQuoteOpen] = useState(false);

  const openQuote = () => setQuoteOpen(true);

  return (
    <>
      <Navbar onQuoteClick={openQuote} />
      <main>
        <Hero onQuoteClick={openQuote} />
        <StatsBar />
        <Features />
        <Pricing onQuoteClick={openQuote} />
        <CTA onQuoteClick={openQuote} />
      </main>
      <Footer />
      <QuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />
    </>
  );
}
