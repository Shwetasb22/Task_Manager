import './globals.css';
import ErrorReporter from '@/components/ErrorReporter';

export const metadata = {
  title: 'Brembo India — Program Command',
  description: 'Program Management and SOP platform',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans bg-brembo-paper text-brembo-ink"><ErrorReporter />{children}</body>
    </html>
  );
}
