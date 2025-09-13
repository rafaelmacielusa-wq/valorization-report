import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Se você precisar publicar em subpasta, ajuste o "base".
  // base: '/minha-subpasta/'
});
