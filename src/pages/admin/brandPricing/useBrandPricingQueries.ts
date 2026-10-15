import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { StoreOption } from '@/components/ui/StorePicker';
import type { ExistingStorePrice } from './brandPricingTypes';
import type { VariantLike } from './brandPricingUtils';

export interface BrandStoreOption extends StoreOption {
  brand: string | null;
}

export const useBrandPricingQueries = (selectedStore: string) => {
  const {
    data: stores = [],
    isLoading: storesLoading,
  } = useQuery<BrandStoreOption[]>({
    queryKey: ['chain-stores'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('stores') as any)
        .select('id, name, brand')
        .not('brand', 'is', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as BrandStoreOption[];
    },
  });

  const { data: existingPrices = [] } = useQuery<ExistingStorePrice[]>({
    queryKey: ['store-prices', selectedStore],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('store_products') as any)
        .select('product_id, variant_id, wholesale_price')
        .eq('brand', selectedStore);
      if (error) throw error;
      return (data ?? []) as ExistingStorePrice[];
    },
    enabled: !!selectedStore,
  });

  const {
    data: allVariants = [],
    isLoading: variantsLoading,
  } = useQuery<VariantLike[]>({
    queryKey: ['all-product-variants'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('product_variants') as any)
        .select('*')
        .order('sku');
      if (error) throw error;
      return (data ?? []) as VariantLike[];
    },
  });

  return {
    stores,
    storesLoading,
    existingPrices,
    allVariants,
    variantsLoading,
  };
};
