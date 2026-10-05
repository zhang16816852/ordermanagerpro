import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 公開型錄資料來源
 * ------------------------------------------------------------
 * 只走 get_public_categories / get_public_products 兩支 SECURITY DEFINER RPC。
 * 刻意「不」直接讀 products / product_variants：那些表的 anon 讀取路徑
 * 與 RLS 目前不成溫（有效 policy 只給 authenticated），而且直讀會讓
 * 成本欄位（wholesale_price / unified_wholesale_price）有外洩風險。
 *
 * ⚠️ nullability：typegen 對 function 回傳欄位一律標成 non-null，但實際上
 *    variant_name / model_name / brand_name / category_* / retail_price /
 *    image_url 在 DB 都可以是 NULL。這裡一律以 nullable 宣告並防禦處理。
 */

export type PublicCategory = {
  id: string;
  slug: string | null;
  name: string;
  product_count: number;
};

export type PublicProduct = {
  item_id: string;
  item_slug: string;
  product_name: string;
  variant_name: string | null;
  model_name: string | null;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  brand_name: string | null;
  retail_price: number | null;
  image_url: string | null;
};

const STALE_MS = 5 * 60 * 1000;

export function usePublicCategories() {
  return useQuery({
    queryKey: ["public-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_categories");
      if (error) throw error;
      return (data ?? []) as PublicCategory[];
    },
    staleTime: STALE_MS,
  });
}

export type PublicProductsParams = {
  categoryId?: string;
  productIds?: string[];
  limit?: number;
  /**
   * 每個產品只回一列（預設 true）。
   *
   * ⚠️ storefront_items 是「產品 × 變體 × 機型」矩陣，同一產品會有多列。
   *    若不開這個開關，首頁取「前 N 列」會被字母序最前的那個產品整包霸佔
   *    （實測：手機殼前 8 列只有 1 個產品、單價全是 200），畫面會是一排重複卡片。
   *    未來 /shop 商品列表要看「同產品不同變體／機型」時才傳 false。
   */
  distinctProducts?: boolean;
};

export function usePublicProducts({
  categoryId,
  productIds,
  limit = 12,
  distinctProducts = true,
}: PublicProductsParams = {}) {
  return useQuery({
    // productIds 排序後入 key，避免呼叫端傳入順序不同就重打
    queryKey: [
      "public-products",
      categoryId ?? null,
      productIds?.length ? [...productIds].sort().join(",") : null,
      limit,
      distinctProducts,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_products", {
        // ⚠️ typegen 把這幾個參數標成 `?:`（非 `| null`），故用 undefined 而非 null；
        //    省略時由 RPC 自己的 DEFAULT 接手，兩者行為一致。
        p_category_id: categoryId?.trim() ? categoryId : undefined,
        p_product_ids: productIds?.length ? productIds : undefined,
        p_limit: limit,
        p_distinct_products: distinctProducts,
      });
      if (error) throw error;
      return (data ?? []) as PublicProduct[];
    },
    staleTime: STALE_MS,
  });
}