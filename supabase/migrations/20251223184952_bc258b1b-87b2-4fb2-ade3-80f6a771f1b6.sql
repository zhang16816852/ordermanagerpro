-- Create data versions table for cache validation
CREATE TABLE public.data_versions (
  table_name text PRIMARY KEY,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Insert initial version for products table
INSERT INTO public.data_versions (table_name, version) VALUES ('products', 1);

-- Enable RLS
ALTER TABLE public.data_versions ENABLE ROW LEVEL SECURITY;

-- Anyone can read versions (needed for cache validation)
CREATE POLICY "Anyone can read data versions"
ON public.data_versions
FOR SELECT
USING (true);

-- Only admins can modify versions directly
CREATE POLICY "Admins can manage data versions"
ON public.data_versions
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));

-- Create function to increment version
CREATE OR REPLACE FUNCTION public.increment_data_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.data_versions 
  SET version = version + 1, updated_at = now()
  WHERE table_name = TG_ARGV[0];
  
  -- If no row exists, insert it
  IF NOT FOUND THEN
    INSERT INTO public.data_versions (table_name, version) 
    VALUES (TG_ARGV[0], 1)
    ON CONFLICT (table_name) DO UPDATE SET version = data_versions.version + 1, updated_at = now();
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create triggers for products table
CREATE TRIGGER products_version_on_insert
AFTER INSERT ON public.products
FOR EACH STATEMENT
EXECUTE FUNCTION public.increment_data_version('products');

CREATE TRIGGER products_version_on_update
AFTER UPDATE ON public.products
FOR EACH STATEMENT
EXECUTE FUNCTION public.increment_data_version('products');

CREATE TRIGGER products_version_on_delete
AFTER DELETE ON public.products
FOR EACH STATEMENT
EXECUTE FUNCTION public.increment_data_version('products');