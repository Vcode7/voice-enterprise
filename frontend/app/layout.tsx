import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { Navbar } from '@/components/Navbar';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'NUMENTRIX Voice ERP - AI Amplify Your Potential',
  description: 'AI-powered voice-first financial tracking, GST invoicing, and dynamic electronic production records with MongoDB Atlas.',
  icons: {
    icon: '/favicon.ico',
    apple: '/numentrix-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const themeInitScript = `
  (function() {
    try {
      var theme = localStorage.getItem('voice_epr_theme') || localStorage.getItem('voice_erp_theme') || 'dark';
      if (theme === 'light') {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.style.colorScheme = 'light';
      } else {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
      }
    } catch(e) {
      document.documentElement.classList.add('dark');
    }
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-background text-text flex min-h-screen antialiased">
        <ThemeProvider>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 min-h-screen">
            <Navbar />
            <main className="flex-1 p-3.5 sm:p-6 md:p-8 pb-24 md:pb-8 max-w-7xl w-full mx-auto">
              {children}
            </main>
            <MobileBottomNav />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
