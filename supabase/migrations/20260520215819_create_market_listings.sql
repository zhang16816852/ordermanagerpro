-- ===================================================
-- Market Listings (媒合平台) Migration
-- ===================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.market_listing_type AS ENUM ('buy', 'sell', 'service');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.market_listing_status AS ENUM ('active', 'draft', 'completed', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.market_contact_method AS ENUM ('line', 'phone', 'telegram');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- market_listings table
CREATE TABLE IF NOT EXISTS public.market_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  main_category TEXT NOT NULL DEFAULT '3c_product',
  listing_type public.market_listing_type NOT NULL,
  sub_category TEXT,
  brand TEXT,
  model TEXT,
  condition TEXT,
  price NUMERIC(10,2),
  title TEXT NOT NULL,
  description TEXT,
  contact_method public.market_contact_method NOT NULL DEFAULT 'line',
  status public.market_listing_status NOT NULL DEFAULT 'draft',
  images TEXT[] DEFAULT ARRAY[]::TEXT[],
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE TRIGGER update_market_listings_updated_at
  BEFORE UPDATE ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;

-- Grant table access
GRANT SELECT ON public.market_listings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_listings TO authenticated;

-- RLS Policies
CREATE POLICY "Anyone can view active market listings"
  ON public.market_listings FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

CREATE POLICY "Authors can view all their own listings"
  ON public.market_listings FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = author_id);

CREATE POLICY "Authenticated users can create listings"
  ON public.market_listings FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = author_id);

CREATE POLICY "Authors can update their own listings"
  ON public.market_listings FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = author_id)
  WITH CHECK ((SELECT auth.uid()) = author_id);

CREATE POLICY "Authors can delete their own listings"
  ON public.market_listings FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = author_id);

CREATE POLICY "Admins can manage all market listings"
  ON public.market_listings FOR ALL
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Add foreign key constraint to public.profiles to enable PostgREST joins
ALTER TABLE public.market_listings
  ADD CONSTRAINT fk_market_listings_author_profile
  FOREIGN KEY (author_id)
  REFERENCES public.profiles(id)
  ON DELETE CASCADE;

-- Add contact fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS line_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_id TEXT;

-- Enable SELECT policy for anyone to resolve profile join reads on market listings
CREATE POLICY "Anyone can view profiles select" ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- pg_cron: Auto-expire listings after 7 days
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.expire_market_listings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, author_id, title
    FROM public.market_listings
    WHERE status = 'active'
      AND published_at IS NOT NULL
      AND published_at < now() - interval '7 days'
  LOOP
    UPDATE public.market_listings SET status = 'draft' WHERE id = rec.id;

    INSERT INTO public.notifications (user_id, title, message, link)
    VALUES (
      rec.author_id,
      '📢 刊登資訊已到期',
      '您的刊登「' || rec.title || '」已超過 7 天刊登期限，已自動轉為草稿。請重新上架或在 30 天內更新，否則將被系統刪除。',
      '/market/my-listings'
    );
  END LOOP;

  DELETE FROM public.market_listings
  WHERE status = 'draft'
    AND updated_at < now() - interval '30 days';
END;
$$;

SELECT cron.schedule(
  'expire-market-listings-daily',
  '0 18 * * *',
  $$SELECT public.expire_market_listings()$$
);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'market_images',
  'market_images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload market images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'market_images');

CREATE POLICY "Anyone can view market images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'market_images');

CREATE POLICY "Users can update their own market images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'market_images' AND owner = (SELECT auth.uid()))
  WITH CHECK (bucket_id = 'market_images');

CREATE POLICY "Users can delete their own market images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'market_images' AND owner = (SELECT auth.uid()));
