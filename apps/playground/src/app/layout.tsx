import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CSS Archaeology Playground · Workfonic Labs',
  description: 'Understand your CSS. Find what is hiding beneath it. Analysis runs entirely in your browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
