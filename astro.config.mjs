import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://arfiligol.github.io",
  base: "/I-LI_CHIU_CV",
  vite: {
    plugins: [tailwindcss()],
  },
});
