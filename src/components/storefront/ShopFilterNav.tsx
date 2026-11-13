import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { CategoryMegaMenu } from "@/components/storefront/CategoryMegaMenu";
import { BrandMegaMenu } from "@/components/storefront/BrandMegaMenu";
import { DeviceModelMegaMenu } from "@/components/storefront/DeviceModelMegaMenu";
import { Button } from "@/components/ui/button";
import type { PublicFilters } from "@/components/storefront/PublicCatalogSidebar";

export function ShopFilterNav({
  filters,
  onChange,
  onClear,
}: {
  filters: PublicFilters;
  onChange: (next: PublicFilters) => void;
  onClear: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const selectedCount =
    (filters.categoryId ? 1 : 0) +
    filters.brandIds.length +
    filters.seriesIds.length +
    filters.modelIds.length +
    Object.values(filters.specFilters).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0);

  const toggleArr = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <>
      {/* Desktop nav-style filter bar */}
      <nav
        aria-label="商品分類導覽"
        className="hidden items-center gap-8 md:flex"
      >
        <CategoryMegaMenu />
        <BrandMegaMenu
          selectedBrands={filters.brandIds}
          selectedSeries={filters.seriesIds}
          onBrandToggle={(id) => onChange({ ...filters, brandIds: toggleArr(filters.brandIds, id) })}
          onSeriesToggle={(id) => onChange({ ...filters, seriesIds: toggleArr(filters.seriesIds, id) })}
        />
        <DeviceModelMegaMenu
          selectedModels={filters.modelIds}
          onModelToggle={(id) => onChange({ ...filters, modelIds: toggleArr(filters.modelIds, id) })}
        />
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="sf-link-underline text-[0.9375rem] text-sf-muted hover:text-sf-text"
          >
            清除篩選 ({selectedCount})
          </button>
        )}
      </nav>

      {/* Mobile hamburger */}
      <div className="md:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMenuOpen(true)}
          className="gap-2"
        >
          <Menu className="h-4 w-4" />
          篩選{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </Button>
        {menuOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-sf-paper">
            <div className="flex items-center justify-between border-b border-[color:var(--sf-line)] px-4 py-3">
              <span className="text-[0.9375rem] font-medium">篩選條件</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <details open>
                <summary className="cursor-pointer text-sm font-medium">商品分類</summary>
                <div className="mt-2">
                  <CategoryMegaMenu onNavigate={() => setMenuOpen(false)} />
                </div>
              </details>
              <details open>
                <summary className="cursor-pointer text-sm font-medium">品牌 / 系列</summary>
                <div className="mt-2">
                  <BrandMegaMenu
                    selectedBrands={filters.brandIds}
                    selectedSeries={filters.seriesIds}
                    onBrandToggle={(id) => onChange({ ...filters, brandIds: toggleArr(filters.brandIds, id) })}
                    onSeriesToggle={(id) => onChange({ ...filters, seriesIds: toggleArr(filters.seriesIds, id) })}
                    onNavigate={() => setMenuOpen(false)}
                  />
                </div>
              </details>
              <details open>
                <summary className="cursor-pointer text-sm font-medium">裝置型號</summary>
                <div className="mt-2">
                  <DeviceModelMegaMenu
                    selectedModels={filters.modelIds}
                    onModelToggle={(id) => onChange({ ...filters, modelIds: toggleArr(filters.modelIds, id) })}
                    onNavigate={() => setMenuOpen(false)}
                  />
                </div>
              </details>
              {selectedCount > 0 && (
                <Button variant="outline" size="sm" onClick={() => { onClear(); setMenuOpen(false); }} className="w-full">
                  清除篩選
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
