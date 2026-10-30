import { useQuery } from "@tanstack/react-query";
import { BlockRenderer } from "./blocks/BlockRenderer";
import { storefrontBlocks as fallbackBlocks } from "@/config/site";
import { storefrontPageSchema } from "./blocks/schema";
import { supabase } from "@/integrations/supabase/client";

/**
 * 公開首頁
 * ------------------------------------------------------------
 * 內容優先從 DB (storefront_pages, slug='home') 讀取；若 DB 無資料或讀取失敗，
 * fallback 到 src/config/site.ts 的 defaultBlocks（經 zod safeParse）。
 * 這樣 admin 編輯後前台重新整理即反映，DB 斷線時也不白畫面。
 */
function useStorefrontBlocks() {
  return useQuery({
    queryKey: ["storefront-page", "home"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("storefront_pages")
        .select("blocks")
        .eq("slug", "home")
        .maybeSingle();
      if (error) throw error;
      const raw = data?.blocks;
      if (Array.isArray(raw) && raw.length > 0) {
        const parsed = storefrontPageSchema.safeParse({ blocks: raw });
        if (parsed.success) return parsed.data.blocks;
      }
      return null;
    },
    staleTime: 60_000,
  });
}

export default function StorefrontPage() {
  const { data: dbBlocks } = useStorefrontBlocks();
  const blocks = (dbBlocks && dbBlocks.length > 0 ? dbBlocks : fallbackBlocks).filter(
    (b: any) => b.enabled,
  );

  return (
    <main id="main" tabIndex={-1} className="outline-none">
      {blocks.map((block: any, i: number) => (
        <div key={`${block.type}-${i}`} id={block.anchor} className={block.anchor ? "scroll-mt-16" : undefined}>
          <BlockRenderer block={block} />
        </div>
      ))}
    </main>
  );
}