'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Mic,
  FileSpreadsheet,
  FileText,
  History,
  Layers,
  Settings,
  Sparkles,
  UploadCloud,
} from 'lucide-react';

import { ThemeToggle } from './theme/ThemeToggle';

const NAV_ITEMS = [
  { name: 'Voice Data Entry', href: '/', icon: FileSpreadsheet },
  { name: 'Handwritten Entry', href: '/handwritten', icon: FileText },
  { name: 'Templates & Tables', href: '/templates', icon: Layers },
  { name: 'History & Logs', href: '/history', icon: History },
  { name: 'SAP Upload', href: '/sap-upload', icon: UploadCloud },
  { name: 'Settings & Export', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-64 bg-card border-r border-cardBorder flex-col justify-between shrink-0 no-print h-screen sticky top-0 transition-colors duration-200">
      <div>
        {/* Brand Header */}
        <div className="p-5 border-b border-cardBorder">
          <Link href="/" className="block group">
            {/* Light Theme Logo */}
            <div className="block dark:hidden">
              <img
                src="/numentrix-logo-light.png"
                alt="NUMENTRIX - AI Amplify Your Potential"
                className="w-full max-h-20 object-contain mx-auto transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </div>
            {/* Dark Theme Logo */}
            <div className="hidden dark:block">
              <img
                src="/numentrix-logo-dark.png"
                alt="NUMENTRIX - AI Amplify Your Potential"
                className="w-full max-h-20 object-contain mx-auto transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </div>
          </Link>
        </div>

        {/* Nav Links */}
        <nav className="p-4 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-primary text-white shadow-md shadow-primary/25 font-semibold'
                    : 'text-textMuted hover:bg-surface hover:text-text'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-textSubtle'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Theme & Status Box */}
      <div className="p-4 border-t border-cardBorder">
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface/70 border border-cardBorder">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-text">Appearance</span>
            <span className="text-[10px] text-textMuted">Theme Switcher</span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
