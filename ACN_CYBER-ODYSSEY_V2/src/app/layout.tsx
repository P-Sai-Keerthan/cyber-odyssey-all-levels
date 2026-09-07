import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ACN Cyber Odyssey - TRACE',
    template: '%s | ACN Cyber Odyssey',
  },
  description: 'ACN Cyber Odyssey - Digital Forensics and Cybersecurity Investigation Portal',
};

export const viewport: Viewport = {
  themeColor: '#06080d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="cyber-grid-bg bg-background text-foreground min-h-screen antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
