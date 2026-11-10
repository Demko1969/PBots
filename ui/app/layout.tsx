import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const description = "Soruları bağımsız yapay zekâ uzmanlarına dağıtan ve görüşleri tek bir sonuçta birleştiren çalışma alanı.";

  return {
    title: "Ortak Akıl — Çoklu Uzman Karar Alanı",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Ortak Akıl",
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "Ortak Akıl — Çoklu uzman karar alanı" }],
    },
    twitter: { card: "summary_large_image", title: "Ortak Akıl", description, images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
