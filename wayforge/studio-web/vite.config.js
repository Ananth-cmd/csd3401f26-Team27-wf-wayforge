// vite.config.js - dev server + build settings for the Studio website
// the /api proxy is for later when the backend is up. while VITE_API_URL
// isn't set the site just uses the mock api in src/api/mockApi.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
