import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { usePublicProducts, usePublicCategoryTree } from "@/storefront/usePublicCatalog";
import { PublicCatalogSidebar, type PublicFilters } from "@/components/storefront/PublicCatalogSidebar";
import { siteBrand } from "@/config/site";

const DEFAULT_FILTERS: PublicFilters = {
  categoryId: null,
  brandIds: [],
  seriesIds: [],
  modelIds: [],
  specFilters: {},
};

function parseFilters(sp: URLSearchParams): PublicFilters {
  return {
    categoryId: sp.get("cat"),
    brandIds: sp.get("brand") ? sp.get("brand")!.split(",").filter(Boolean) : [],
    seriesIds: sp.get("series") ? sp.get("series")!.split(",").filter(Boolean) : [],
    modelIds: sp.get("model") ? sp.get("model")!.split(",").filter(Boolean) : [],
    specFilters: (() => {
      const out: Record<string, string[]> = {};
      sp.forEach((v, k) => {
        if (k.startsWith("spec.")) {
          out[k.slice(5)] = v.split(",").filter(Boolean);
        }
      });
      return out;
    })(),
  };
}

function serializeFilters(f: PublicFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.categoryId) sp.set("cat", f.categoryId);
  if (f.brandIds.length) sp.set("brand", f.brandIds.join(","));
  if (f.seriesIds.length) sp.set("series", f.seriesIds.join(","));
  if (f.modelIds.length) sp.set("model", f.modelIds.join(","));
  Object.entries(f.specFilters).forEach(([k, v]) => {
    if (v.length) sp.set(`spec.${k}`, v.join(","));
  });
  return sp;
}

export default function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [filters, setFiltersState] = useState<PublicFilters>(() => parseFilters(searchParams));
  const [sheetOpen, setSheetOpen] = useState(false);

  const setFilters = (next: PublicFilters) => {
    setFiltersState(next);
    const sp = serializeFilters(next);
    if (search.trim()) sp.set("q", search.trim());
    setSearchParams(sp, { replace: true });
  };

  const { data: products, isLoading, isFetching } = usePublicProducts({
    categoryId: filters.categoryId ?? undefined,
    limit: 60,
    distinctProducts: true,
    search: search.trim() || undefined,
    brandIds: filters.brandIds.length ? filters.brandIds : undefined,
    modelIds: filters.modelIds.length ? filters.modelIds : undefined,
  });

  // client-side spec filter
  const filtered = useMemo(() => {
    const list = products ?? [];
    const specKeys = Object.keys(filters.specFilters);
    if (specKeys.length === 0) return list;
    return list.filter((p) => {
      const sv = p.spec_values ?? {};
      return specKeys.every((k) => {
        const wanted = filters.specFilters[k];
        if (!wanted || wanted.length === 0) return true;
        const val = sv[k];
        const str = typeof val === "string" ? val : val != null ? String(val) : "";
        return wanted.includes(str);
      });
    });
  }, [products, filters.specFilters]);

  const handleSearch = (val: string) => {
    setSearch(val);
    const sp = serializeFilters(filters);
    if (val.trim()) sp.set("q", val.trim());
    else sp.delete("q");
    setSearchParams(sp, { replace: true });
  };

  const clearAll = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const activeCount =
    (filters.categoryId ? 1 : 0) +
    filters.brandIds.length +
    filters.seriesIds.length +
    filters.modelIds.length +
    Object.values(filters.specFilters).reduce((a, b) => a + b.length, 0);

  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <div className="sf-container py-10">
        <header className="mb-6">
          <p className="sf-eyebrow">{siteBrand.tagline}</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-sf-text">商品目錄</h1>
        </header>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sf-muted" />
            <Input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜尋商品名稱、品牌、分類..."
              className="pl-9"
            />
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="lg:hidden">
                <Filter className="mr-2 h-4 w-4" /> 篩選{activeCount > 0 ? ` (${activeCount})` : ""}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetTitle className="sr-only">篩選條件</SheetTitle>
              <PublicCatalogSidebar filters={filters} onChange={setFilters} onClear={clearAll} />
            </SheetContent>
          </Sheet>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-20">
              <PublicCatalogSidebar filters={filters} onChange={setFilters} onClear={clearAll} />
            </div>
          </aside>

          <section>
            {isLoading ? (
              <div className="py-20 text-center text-sf-muted">載入中...</div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center text-sf-muted">沒有找到符合的商品</div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {filtered.map((p) => (
                  <Link
                    key={p.item_id}
                    to={`/shop/${p.product_id}`}
                    className="group flex flex-col overflow-hidden rounded-xl border border-[color:var(--sf-line)] bg-sf-surface transition-all hover:border-sf-text hover:shadow-md"
                  >
                    <div className="aspect-square bg-sf-paper flex items-center justify-center overflow-hidden">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.product_name}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-xs text-sf-muted/40">No Image</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      {p.brand_name && (
                        <span className="sf-eyebrow text-[0.6875rem]">{p.brand_name}</span>
                      )}
                      <h3 className="mt-1 line-clamp-2 text-sm font-medium text-sf-text">
                        {p.product_name}
                      </h3>
                      {p.variant_name && p.variant_name !== p.product_name && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-sf-muted">{p.variant_name}</p>
                      )}
                      {p.model_name && (
                        <p className="line-clamp-1 text-xs text-sf-muted">{p.model_name}</p>
                      )}
                      <div className="mt-auto pt-2">
                        {p.retail_price != null ? (
                          <span className="text-base font-semibold text-sf-text">
                            ${Number(p.retail_price).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-xs text-sf-muted">價格洽詢</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {isFetching && !isLoading && (
              <div className="mt-4 text-center text-xs text-sf-muted">更新中...</div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}