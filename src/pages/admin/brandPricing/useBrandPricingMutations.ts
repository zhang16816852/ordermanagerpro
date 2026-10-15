import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import type { PriceEntry } from './brandPricingTypes';
import type { VariantLike } from './brandPricingUtils';

interface UseBrandPricingMutationsArgs {
  selectedStore: string;
  selectedProducts: Set<string>;
  priceEntries: Record<string, PriceEntry>;
  allVariants: VariantLike[];
}

export const useBrandPricingMutations = ({
  selectedStore,
  selectedProducts,
  priceEntries,
  allVariants,
}: UseBrandPricingMutationsArgs) => {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStore) throw new Error('請先選擇連鎖客戶');
      if (selectedProducts.size === 0) throw new Error('請選擇至少一個產品');

      const itemsToSave = Array.from(selectedProducts).map((key) => {
        const [productId, variantId] = key.includes(':') ? key.split(':') : [key, null];

        const entry = priceEntries[key];
        const variant = variantId ? allVariants.find((v) => v.id === variantId) : null;

        return {
          product_id: productId,
          variant_id: variantId,
          wholesale_price: entry?.wholesalePrice
            ? parseFloat(entry.wholesalePrice)
            : (variant?.wholesale_price ?? 0),
        };
      });

      const { error } = await supabase.rpc('upsert_brand_product_prices', {
        p_brand: selectedStore,
        p_products: itemsToSave,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已成功更新價格');
      queryClient.invalidateQueries({ queryKey: ['store-prices', selectedStore] });
    },
    onError: (error: Error) => {
      toast.error(`儲存失敗: ${getErrorMessage(error)}`);
    },
  });

  return { saveMutation };
};
