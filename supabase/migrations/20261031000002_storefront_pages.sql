-- =============================================================================
-- storefront_pages：公開首頁 block 清單的 DB 儲存（後台可編輯）
-- -----------------------------------------------------------------------------
-- 目的：把 src/config/site.ts 的 defaultBlocks 搬進 DB，admin 可編輯/排序/啟用，
--       前台 StorefrontPage 讀 DB，失敗/無資料時 fallback site.ts。
--
-- 設計：一列 = 一頁（slug 唯一）。blocks 為 jsonb 陣列，與 zod schema 對齊。
-- RLS：admin 全權；anon/authenticated 只讀（公開首頁）。
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.storefront_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  blocks      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.storefront_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storefront_pages_admin_all ON public.storefront_pages;
CREATE POLICY storefront_pages_admin_all
  ON public.storefront_pages
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS storefront_pages_public_read ON public.storefront_pages;
CREATE POLICY storefront_pages_public_read
  ON public.storefront_pages
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- seed：把目前 defaultBlocks 寫入 home（若不存在）
INSERT INTO public.storefront_pages (slug, blocks)
SELECT 'home', '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.storefront_pages WHERE slug = 'home');

GRANT SELECT ON public.storefront_pages TO anon, authenticated;