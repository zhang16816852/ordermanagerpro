import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductCache } from '@/hooks/useProductCache';
import { BrandPricingHeader } from './brandPricing/BrandPricingHeader';
import { BrandPricingStoreCard } from './brandPricing/BrandPricingStoreCard';
import { BrandPricingBatchEditor } from './brandPricing/BrandPricingBatchEditor';
import { BrandPricingSearchBar } from './brandPricing/BrandPricingSearchBar';
import { BrandPricingProductList } from './brandPricing/BrandPricingProductList';
import {
  BrandPricingOptionFilters,
  BrandPricingMobileFilters,
} from './brandPricing/BrandPricingOptionFilters';
import { useBrandPricingQueries } from './brandPricing/useBrandPricingQueries';
import { useBrandPricingSelection } from './brandPricing/useBrandPricingSelection';
import { useBrandPricingFilters } from './brandPricing/useBrandPricingFilters';
import { useBrandPricingMutations } from './brandPricing/useBrandPricingMutations';

export default function AdminStorePricing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { products, isLoading: productsLoading, forceRefresh } = useProductCache();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [selectedStore, setSelectedStore] = useState<string>(searchParams.get('store') || '');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const { stores, storesLoading, existingPrices, allVariants, variantsLoading } =
    useBrandPricingQueries(selectedStore);

  const {
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
  } = useBrandPricingSelection({ existingPrices, allVariants });

  const {
    selectedOptions,
    hasOptionFilter,
    activeFilterCount,
    searchTerms,
    variantMatchesSearch,
    displayedVariantsOf,
    filteredProducts,
    optionFacets,
    toggleOptionValue,
    clearOptionFilters,
  } = useBrandPricingFilters({ products, allVariants, search });

  const { saveMutation } = useBrandPricingMutations({
    selectedStore,
    selectedProducts,
    priceEntries,
    allVariants,
  });

  // 搜尋詞命中變體名稱時，自動展開對應產品
  useEffect(() => {
    if (searchTerms.length === 0) return;
    const matchedIds = products
      .filter((p) =>
        allVariants.some(
          (v) => v.product_id === p.id && v.status === 'active' && variantMatchesSearch(v),
        ),
      )
      .map((p) => p.id);
    if (matchedIds.length === 0) return;
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      matchedIds.forEach((id) => next.add(id));
      return next;
    });
  }, [searchTerms, products, allVariants, variantMatchesSearch, setExpandedProducts]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('search', value);
        else next.delete('search');
        return next;
      },
      { replace: true },
    );
  };

  const handleStoreChange = (value: string) => {
    setSelectedStore(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('store', value);
        else next.delete('store');
        return next;
      },
      { replace: true },
    );
  };

  const isLoading = productsLoading || storesLoading || variantsLoading;
  const totalSelectableCount = getTotalSelectableCount(filteredProducts);

  return (
    <div className="space-y-6">
      <BrandPricingHeader onRefresh={forceRefresh} />

      <BrandPricingStoreCard
        stores={stores}
        selectedStore={selectedStore}
        onStoreChange={handleStoreChange}
      />

      <BrandPricingBatchEditor
        selectedCount={selectedProducts.size}
        isPending={saveMutation.isPending}
        canSave={!!selectedStore}
        onApplyBatchPrice={applyBatchPrice}
        onSave={() => saveMutation.mutate()}
      />

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-4">
          <BrandPricingSearchBar
            search={search}
            onSearchChange={handleSearchChange}
            productCount={filteredProducts.length}
            activeFilterCount={activeFilterCount}
            onToggleFilters={() => setFiltersOpen((v) => !v)}
          />

          <BrandPricingProductList
            isLoading={isLoading}
            filteredProducts={filteredProducts}
            allVariants={allVariants}
            priceEntries={priceEntries}
            selectedProducts={selectedProducts}
            expandedProducts={expandedProducts}
            totalSelectableCount={totalSelectableCount}
            displayedVariantsOf={displayedVariantsOf}
            onToggleProduct={toggleProduct}
            onToggleExpanded={toggleExpanded}
            onToggleAll={() => toggleAll(filteredProducts)}
            onPriceChange={handlePriceChange}
          />
        </div>

        {filtersOpen && (
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-4 rounded-lg border bg-card p-4 shadow-soft">
              <BrandPricingOptionFilters
                optionFacets={optionFacets}
                selectedOptions={selectedOptions}
                hasOptionFilter={hasOptionFilter}
                onToggleOptionValue={toggleOptionValue}
                onClear={clearOptionFilters}
              />
            </div>
          </aside>
        )}
      </div>

      <BrandPricingMobileFilters
        open={mobileFiltersOpen}
        activeFilterCount={activeFilterCount}
        onOpen={() => setMobileFiltersOpen(true)}
        onClose={() => setMobileFiltersOpen(false)}
        optionFacets={optionFacets}
        selectedOptions={selectedOptions}
        hasOptionFilter={hasOptionFilter}
        onToggleOptionValue={toggleOptionValue}
        onClear={clearOptionFilters}
      />
    </div>
  );
}
