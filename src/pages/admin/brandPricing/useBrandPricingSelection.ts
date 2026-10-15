import { useEffect, useState } from 'react';
import type { ProductWithDetails } from '@/types/product';
import type { ExistingStorePrice, PriceEntry } from './brandPricingTypes';
import { getProductVariants, type VariantLike } from './brandPricingUtils';

interface UseBrandPricingSelectionArgs {
  existingPrices: ExistingStorePrice[];
  allVariants: VariantLike[];
}

export const useBrandPricingSelection = ({
  existingPrices,
  allVariants,
}: UseBrandPricingSelectionArgs) => {
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [priceEntries, setPriceEntries] = useState<Record<string, PriceEntry>>({});
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!existingPrices) return;

    if (existingPrices.length > 0) {
      const entries: Record<string, PriceEntry> = {};
      existingPrices.forEach((p) => {
        const key = p.variant_id ? `${p.product_id}:${p.variant_id}` : p.product_id;
        entries[key] = {
          productId: p.product_id,
          variantId: p.variant_id || undefined,
          wholesalePrice: p.wholesale_price?.toString() || '',
        };
      });
      setPriceEntries((prev) => ({ ...prev, ...entries }));
    }
  }, [existingPrices]);

  const handlePriceChange = (key: string, productId: string, variantId: string | undefined, value: string) => {
    setPriceEntries((prev) => ({
      ...prev,
      [key]: { productId, variantId, wholesalePrice: value },
    }));
  };

  const toggleProduct = (key: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleExpanded = (productId: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleAll = (filteredProducts: ProductWithDetails[]) => {
    const allKeys: string[] = [];
    filteredProducts.forEach((p) => {
      const variants = getProductVariants(allVariants, p.id);
      if (variants.length > 0 && !p.unified_pricing) {
        variants.forEach((v) => allKeys.push(`${p.id}:${v.id}`));
      } else {
        allKeys.push(p.id);
      }
    });

    if (selectedProducts.size === allKeys.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(allKeys));
    }
  };

  const applyBatchPrice = (value: string) => {
    const newEntries = { ...priceEntries };
    selectedProducts.forEach((key) => {
      const [productId, variantId] = key.includes(':') ? key.split(':') : [key, undefined];
      newEntries[key] = { productId, variantId, wholesalePrice: value };
    });
    setPriceEntries(newEntries);
  };

  const getTotalSelectableCount = (filteredProducts: ProductWithDetails[]) => {
    let count = 0;
    filteredProducts.forEach((p) => {
      const variants = getProductVariants(allVariants, p.id);
      count += variants.length > 0 ? variants.length : 1;
    });
    return count;
  };

  return {
    selectedProducts,
    priceEntries,
    expandedProducts,
    setExpandedProducts,
    handlePriceChange,
    toggleProduct,
    toggleExpanded,
    toggleAll,
    applyBatchPrice,
    getTotalSelectableCount,
  };
};