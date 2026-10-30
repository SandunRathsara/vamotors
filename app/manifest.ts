import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "VSMS — VA Motors",
    short_name: "VA Motors",
    description: "Vehicle Sale Management System. Online access required.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "en",
    icons: [
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }
}
