'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, ShieldCheck, AlertCircle, Mic } from 'lucide-react';
import { AskAIModal } from './modals/AskAIModal';
import { ThemeToggle } from './theme/ThemeToggle';
import { apiUrl } from '@/lib/api/apiClient';

export function Navbar() {
  const [showAskAI, setShowAskAI] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ isConfigured: boolean; activeKeyType: string }>({
    isConfigured: false,
    activeKeyType: 'none',
  });

  useEffect(() => {
    fetch(apiUrl('/api/groq/status'))
      .then((res) => res.json())
      .then((data) => setKeyStatus(data))
      .catch(() => {});
  }, []);

  return (
    <>
      <header className="h-14 sm:h-16 bg-card/85 backdrop-blur-md border-b border-cardBorder px-4 sm:px-6 flex items-center justify-between shrink-0 sticky top-0 z-30 no-print transition-colors duration-200">
        <div className="flex items-center space-x-3">
          {/* Mobile Brand Logo */}
          <Link href="/" className="md:hidden flex items-center">
            {/* Light Theme Logo */}
            <div className="block dark:hidden">
              <img
                src="/logo-horizontal-light.png"
                alt="NUMENTRIX"
                className="h-8 sm:h-9 w-auto max-w-[160px] object-contain"
              />
            </div>
            {/* Dark Theme Logo */}
            <div className="hidden dark:block">
              <img
                src="/logo-horizontal-dark.png"
                alt="NUMENTRIX"
                className="h-8 sm:h-9 w-auto max-w-[160px] object-contain"
              />
            </div>
          </Link>

          
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <ThemeToggle />

          <button
            onClick={() => setShowAskAI(true)}
            className="flex items-center space-x-1.5 sm:space-x-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-primaryDark to-primary hover:from-primary hover:to-orange-500 text-white text-xs font-semibold shadow-md shadow-primary/25 transition-all cursor-pointer active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            <span>Ask AI</span>
          </button>
        </div>
      </header>

      {showAskAI && <AskAIModal onClose={() => setShowAskAI(false)} />}
    </>
  );
}
