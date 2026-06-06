import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { strings } from "@/lib/strings";

export const metadata: Metadata = {
  title: "Canadian Hydrometric Data — WSC Flood Frequency Analysis",
  description:
    "Explore Water Survey of Canada hydrometric gauges, historic flow data, and flood frequency analysis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col bg-white text-gray-900 antialiased">
        <header className="border-b border-gray-200 bg-white z-50">
          <div className="max-w-screen-xl mx-auto px-4 h-12 flex items-center justify-between">
            <Link href="/" className="font-semibold text-blue-700 hover:text-blue-800 text-sm tracking-tight">
              {strings.appName}
            </Link>
            <nav className="flex gap-5 text-sm text-gray-600">
              <Link href="/" className="hover:text-gray-900">Map</Link>
              <Link href="/about" className="hover:text-gray-900">About</Link>
            </nav>
          </div>
        </header>

        <main className="flex-1 flex flex-col">{children}</main>

        <footer className="border-t border-gray-200 text-xs text-gray-500 py-3">
          <div className="max-w-screen-xl mx-auto px-4 space-y-1">
            <p>
              {strings.footer.attribution}{" "}
              <a
                href="https://eccc-msc.github.io/open-data/licence/readme_en/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                {strings.footer.licence}
              </a>
              . {strings.footer.notEndorsed}
            </p>
            <p>{strings.footer.osm}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
