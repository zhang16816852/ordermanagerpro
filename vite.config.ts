import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string, { getModuleInfo }) {
          if (!/node_modules/.test(id)) return;
          // xlsx 必須強制拆獨立 chunk：若不處理，Rollup 會將其樹搖為空模組
          if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id)) return "xlsx-lib";
          const moduleInfo = getModuleInfo(id);
          // 純動態 import 的依賴（無靜態引用）交給 Rollup 自動拆 async chunk
          if (moduleInfo && moduleInfo.importers?.length === 0 && moduleInfo.dynamicImporters?.length > 0) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|@tanstack)[\\/]/.test(id)) return "react-core";
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return "supabase";
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return "radix-ui";
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icons";
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]*|react-smooth)[\\/]/.test(id)) return "charts";
          if (/[\\/]node_modules[\\/](react-router|react-router-dom|zustand|idb|date-fns|zod)[\\/]/.test(id)) return "router-store";
          return "vendor";
        },
      },
    },
  },
}));
