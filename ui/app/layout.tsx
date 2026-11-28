import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const description = "A workspace that assigns questions to independent AI experts and combines their findings into one answer.";

  return {
    title: "Ortak Akıl — Multi-Expert Workspace",
    description,
    icons: { icon: "/ortak-akil-lens.svg", shortcut: "/ortak-akil-lens.svg" },
    openGraph: {
      title: "Ortak Akıl",
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "Ortak Akıl — Multi-expert workspace" }],
    },
    twitter: { card: "summary_large_image", title: "Ortak Akıl", description, images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
