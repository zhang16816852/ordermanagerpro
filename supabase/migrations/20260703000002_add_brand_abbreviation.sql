-- Add abbreviation column to brands table
ALTER TABLE public.brands ADD COLUMN abbreviation VARCHAR(50);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
