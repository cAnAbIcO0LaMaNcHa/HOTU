import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { LanguageProvider } from "@/lib/i18n";
import { AuthSessionProvider } from "@/components/session-provider";
import { CartProvider } from "@/components/cart-context";
import { CartDrawer } from "@/components/cart-drawer";
import { ventaOnlineHabilitada } from "@/lib/flags";

export const metadata: Metadata = {
  metadataBase: new URL("https://hotu.com.co"), // TODO: cambiar por tu dominio real
  title: {
    default: "HOTU · House of the Unknown — Hub de movimientos electrónicos en Bogotá",
    template: "%s · HOTU",
  },
  description:
    "HOTU (House of the Unknown) es el hub para descubrir movimientos, fiestas y colectivos de música electrónica en Bogotá, y conectar artistas con aficionados que comparten el mismo mood.",
  keywords: [
    "HOTU",
    "House of the Unknown",
    "techno Bogotá",
    "colectivos Bogotá",
    "eventos electrónica Bogotá",
    "raves Bogotá",
    "artistas techno Colombia",
  ],
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "HOTU · House of the Unknown",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * Se lee UNA vez acá y baja a los dos lugares que lo necesitan. El layout es
   * server component, así que puede leer el entorno; el header y el cajón son
   * client components y no.
   */
  const venta = ventaOnlineHabilitada();

  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "HOTU · House of the Unknown",
              url: "https://hotu.com.co",
              description:
                "Hub de movimientos electrónicos en Bogotá. Conectamos artistas y aficionados.",
              areaServed: "Bogotá, Colombia",
            }),
          }}
        />
      </head>
      <body className="concrete min-h-screen">
        <AuthSessionProvider>
          <LanguageProvider>
            {/*
              EL CartProvider QUEDA MONTADO AUNQUE LA VENTA ESTÉ APAGADA, y no es
              un descuido: site-header llama a useCart(), que LANZA sin provider,
              así que sacarlo dejaría la pantalla en blanco en todo el sitio.

              Queda inerte. Sin botones que le agreguen nada y sin cajón que lo
              muestre, el carrito no puede tener contenido alcanzable — y aunque
              alguien tuviera items guardados en localStorage de antes, no hay
              forma de verlos ni de pagarlos: createPendingOrder se niega.
            */}
            <CartProvider>
              <SiteHeader ventaOnline={venta} />
              {children}
              <SiteFooter />
              {venta && <CartDrawer />}
            </CartProvider>
          </LanguageProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
