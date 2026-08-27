import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://aldus.media",
  integrations: [
    react(),
    starlight({
      title: "Aldus",
      description: "Read, listen, and run your self-hosted Aldus library.",
      logo: { src: "./public/images/icon.png", alt: "Aldus" },
      favicon: "/images/icon.png",
      customCss: ["./src/styles/global.css"],
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/mahcks/aldus",
        },
      ],
      editLink: { baseUrl: "https://github.com/mahcks/aldus/edit/main/docs/" },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Welcome to Aldus", slug: "getting-started" },
            { label: "Explore the demo", slug: "getting-started/demo" },
            { label: "Connect to a server", slug: "getting-started/connect" },
          ],
        },
        {
          label: "Read and listen",
          items: [
            { label: "iPhone and iPad", slug: "read-listen/ios" },
            { label: "Android", slug: "read-listen/android" },
            { label: "Offline use", slug: "read-listen/offline" },
            {
              label: "Exact synchronization",
              slug: "read-listen/synchronization",
            },
          ],
        },
        {
          label: "E-readers",
          items: [
            { label: "KOReader", slug: "ereaders/koreader" },
            { label: "OPDS access", slug: "ereaders/opds" },
          ],
        },
        {
          label: "Server administration",
          collapsed: true,
          items: [
            { label: "Install Aldus", slug: "admin/install" },
            { label: "Libraries and members", slug: "admin/libraries" },
            { label: "Users and recovery", slug: "admin/users" },
            { label: "Media sources", slug: "admin/sources" },
            { label: "Automatic requests", slug: "admin/acquisitions" },
            { label: "Backups and upgrades", slug: "admin/backups" },
          ],
        },
        {
          label: "Reference",
          collapsed: true,
          items: [
            { label: "Streaming architecture", slug: "reference/streaming" },
          ],
        },
        { label: "Support", slug: "support" },
        { label: "Privacy", slug: "privacy" },
      ],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
