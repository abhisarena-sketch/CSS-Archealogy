import './globals.css';
import './theme.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="layout">{children}</body>
    </html>
  );
}
