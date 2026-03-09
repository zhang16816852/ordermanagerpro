-- Create brands table
CREATE TABLE IF NOT EXISTS public.brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add brand_id to products
ALTER TABLE public.products
ADD COLUMN brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;

-- Create index for brand_id
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON public.products(brand_id);

-- Enable RLS for brands
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- Create policies for brands
CREATE POLICY "Enable read access for all users" ON public.brands FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON public.brands FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users only" ON public.brands FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Enable delete for authenticated users only" ON public.brands FOR DELETE USING (auth.role() = 'authenticated');

-- Create a trigger to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_brands_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_brands_updated_at_trigger
    BEFORE UPDATE ON public.brands
    FOR EACH ROW
    EXECUTE PROCEDURE update_brands_updated_at();

-- Notify views/clients about schema change, not strictly necessary but good practice
NOTIFY pgrst, 'reload schema';
