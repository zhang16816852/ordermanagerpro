import { Tables, TablesInsert } from '@/integrations/supabase/types';
type Product = Tables<'products'>;
type ProductInsert = TablesInsert<'products'>;
type ProductVariant = Tables<'product_variants'>;
export type ProductFormValues = {
  id?: string;

  sku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  series?: string | null;
  category?: string | null;
  color?: string | null;
  barcode?: string | null;

  base_wholesale_price: number;
  base_retail_price: number;
  status: 'active' | 'preorder' | 'sold_out' | 'discontinued';
  has_variants: boolean;

  variants: ProductVariant[];
};
