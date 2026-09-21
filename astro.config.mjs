import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Both Astro and the PDF preview use the same build-time deployment target.
  site: process.env.SITE_URL ?? "https://arfiligol.github.io",
  base: process.env.BASE_PATH ?? "/I-LI_CHIU_CV",
  vite: {
    plugins: [tailwindcss()],
  },
});
