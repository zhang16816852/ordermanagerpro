import { useMemo, useState } from 'react';
import type { ProductWithDetails, ProductOptionValue } from '@/types/product';
import {
  optionValueKey,
  type VariantLike,
  type OptionFacet,
  type DisplayedVariantsOf,
} from './brandPricingUtils';

interface UseBrandPricingFiltersArgs {
  products: ProductWithDetails[];
  allVariants: VariantLike[];
  search: string;
}

export const useBrandPricingFilters = ({
  products,
  allVariants,
  search,
}: UseBrandPricingFiltersArgs) => {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});

  const searchTerms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const variantMatchesSearch = useMemo(
    () =>
      (v: { name?: string | null; sku?: string | null }) => {
        if (searchTerms.length === 0) return true;
        const hay = `${v.name ?? ''} ${v.sku ?? ''}`.toLowerCase();
        return searchTerms.every((t) => hay.includes(t));
      },
    [searchTerms],
  );

  const variantOptionGroupsMap = useMemo(() => {
    const variantMap = new Map<string, Map<string, Set<string>>>();
    products.forEach((p) => {
      const nameMap = new Map<string, string>();
      (p.option_groups ?? []).forEach((g: any) => nameMap.set(g.id, g.name));
      (p.variants ?? []).forEach((v: any) => {
        const groups = new Map<string, Set<string>>();
        const values = (v.option_values ?? []) as ProductOptionValue[];
        values.forEach((ov) => {
          const gName = nameMap.get(ov.group_id);
          if (!gName) return;
          const set = groups.get(gName) ?? new Set<string>();
          set.add(optionValueKey(ov));
          groups.set(gName, set);
        });
        variantMap.set(v.id, groups);
      });
    });
    return variantMap;
  }, [products]);

  const selectedOptionGroups = useMemo(
    () => Object.entries(selectedOptions).filter(([, vals]) => vals.length > 0),
    [selectedOptions],
  );
  const hasOptionFilter = selectedOptionGroups.length > 0;
  const activeFilterCount = selectedOptionGroups.reduce((n, [, vals]) => n + vals.length, 0);

  const variantMatchesOptions = useMemo(
    () =>
      (variantId: string) => {
        if (selectedOptionGroups.length === 0) return true;
        const groups = variantOptionGroupsMap.get(variantId);
        if (!groups) return false;
        return selectedOptionGroups.every(([groupName, values]) => {
          const set = groups.get(groupName);
          return !!set && values.some((val) => set.has(val));
        });
      },
    [selectedOptionGroups, variantOptionGroupsMap],
  );

  const displayedVariantsOf: DisplayedVariantsOf = (variants) => {
    let matched = variants;
    if (hasOptionFilter) matched = matched.filter((v) => variantMatchesOptions(v.id));
    if (searchTerms.length > 0) {
      const bySearch = matched.filter(variantMatchesSearch);
      if (bySearch.length > 0) matched = bySearch;
    }
    if (matched.length > 0) return matched;
    return hasOptionFilter ? [] : variants;
  };

  const searchMatchedProducts = useMemo(() => {
    if (searchTerms.length === 0) return products;
    return products.filter((p) => {
      const variantNames = allVariants
        .filter((v) => v.product_id === p.id && v.status === 'active')
        .map((v) => `${v.name ?? ''} ${v.sku ?? ''}`);
      const hay = [p.name ?? '', p.code ?? '', ...variantNames]
        .join(' ')
        .toLowerCase();
      return searchTerms.every((t) => hay.includes(t));
    });
  }, [products, allVariants, searchTerms]);

  const filteredProducts = useMemo(() => {
    if (!hasOptionFilter) return searchMatchedProducts;
    return searchMatchedProducts.filter((p) =>
      allVariants.some(
        (v) =>
          v.product_id === p.id &&
          v.status === 'active' &&
          variantMatchesOptions(v.id),
      ),
    );
  }, [searchMatchedProducts, allVariants, hasOptionFilter, variantMatchesOptions]);

  const optionFacets = useMemo<OptionFacet[]>(() => {
    const facetMap = new Map<string, Map<string, Set<string>>>();
    searchMatchedProducts.forEach((p) => {
      const activeVariants = allVariants.filter(
        (v) => v.product_id === p.id && v.status === 'active',
      );
      let scoped = activeVariants;
      if (searchTerms.length > 0) {
        const bySearch = activeVariants.filter(variantMatchesSearch);
        if (bySearch.length > 0) scoped = bySearch;
      }
      scoped.forEach((v) => {
        const groups = variantOptionGroupsMap.get(v.id);
        if (!groups) return;
        groups.forEach((values, groupName) => {
          const vals = facetMap.get(groupName) ?? new Map<string, Set<string>>();
          values.forEach((val) => {
            const set = vals.get(val) ?? new Set<string>();
            set.add(p.id);
            vals.set(val, set);
          });
          facetMap.set(groupName, vals);
        });
      });
    });
    return Array.from(facetMap.entries())
      .map(([name, vals]) => ({
        name,
        values: Array.from(vals.entries())
          .map(([value, set]) => ({ value, count: set.size }))
          .sort((a, b) => a.value.localeCompare(b.value, 'zh-TW')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  }, [searchMatchedProducts, allVariants, variantMatchesSearch, searchTerms, variantOptionGroupsMap]);

  const toggleOptionValue = (groupName: string, value: string) => {
    setSelectedOptions((prev) => {
      const current = prev[groupName] ?? [];
      const nextValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const next = { ...prev };
      if (nextValues.length === 0) delete next[groupName];
      else next[groupName] = nextValues;
      return next;
    });
  };

  const clearOptionFilters = () => setSelectedOptions({});

  return {
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
  };
};
