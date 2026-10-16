import type { MetadataRoute } from "next";

/**
 * Lets a phone add this app to its home screen with the ITPF mark, a proper
 * name, and no browser chrome. iOS reads the `apple-icon`/`appleWebApp`
 * metadata in `layout.tsx` instead of this file, but Android and desktop
 * "install" prompts read this manifest directly.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ITPF Competition System",
    short_name: "ITPF",
    description:
      "Official competition management and scoring for International Tent Pegging Federation championships.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c3d4e",
    theme_color: "#00718f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
