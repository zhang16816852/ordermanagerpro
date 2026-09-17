import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductSearch } from '@/hooks/useProductSearch';

export interface CatalogFilterInput {
  categories: { id: string; name: string }[];
  categoryHierarchy: any[];
  brandMap: Record<string, string>;
  storeProducts: any[] | undefined;
  productSearch: string;
}

export function useCatalogFilters({
  categories,
  categoryHierarchy,
  brandMap,
  storeProducts,
  productSearch,
}: CatalogFilterInput) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCategoryName = searchParams.get('category');
  const selectedBrandsParam = useMemo(
    () => searchParams.get('brands')?.split(',').filter(Boolean) || [],
    [searchParams]
  );
  const selectedSpecs = useMemo(() => {
    try {
      const s = searchParams.get('specs');
      return s ? JSON.parse(s) : {};
    } catch { return {}; }
  }, [searchParams]);

  const selectedCategory = useMemo(() => {
    if (!selectedCategoryName || categories.length === 0) return null;
    return categories.find((c) => c.name === selectedCategoryName)?.id || null;
  }, [selectedCategoryName, categories]);

  // Sidebar filter callbacks
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        });
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const handleCategoryChange = useCallback(
    (id: string | null) => {
      const cat = categories.find((c) => c.id === id);
      updateParams({ category: cat ? cat.name : null, specs: null });
    },
    [categories, updateParams]
  );

  const handleBrandsChange = useCallback(
    (val: string[]) => updateParams({ brands: val.length > 0 ? val.join(',') : null }),
    [updateParams]
  );

  const handleSpecChange = useCallback(
    (key: string, values: string[]) => {
      const nextSpecs = { ...selectedSpecs };
      if (values.length === 0) delete nextSpecs[key];
      else nextSpecs[key] = values;
      updateParams({
        specs: Object.keys(nextSpecs).length > 0 ? JSON.stringify(nextSpecs) : null,
      });
    },
    [selectedSpecs, updateParams]
  );

  const handleClearFilters = useCallback(() => {
    updateParams({ category: null, brands: null, specs: null });
  }, [updateParams]);

  const filteredProducts = useProductSearch({
    products: storeProducts || [],
    search: productSearch,
    selectedCategory,
    categoryHierarchy,
    selectedBrands: selectedBrandsParam,
    selectedSpecs,
    brandMap,
  });

  return {
    selectedCategoryName,
    selectedBrandsParam,
    selectedSpecs,
    selectedCategory,
    filteredProducts,
    handleCategoryChange,
    handleBrandsChange,
    handleSpecChange,
    handleClearFilters,
  };
}