import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePublicCategories, usePublicProducts } from "@/storefront/usePublicCatalog";
import { siteBrand } from "@/config/site";

export default function ShopPage() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const PAGE_SIZE = 24;

  const { data: categories, isLoading: catLoading } = usePublicCategories();
  const { data: products, isLoading: prodLoading, isFetching } = usePublicProducts({
    categoryId: categoryId ?? undefined,
    limit: PAGE_SIZE,
    distinctProducts: true,
  });

  const filtered = useMemo(() => {
    const list = products ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      [p.product_name, p.variant_name, p.brand_name, p.category_name, p.model_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [products, search]);

  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <div className="sf-container py-10">
        <header className="mb-8">
          <p className="sf-eyebrow">{siteBrand.tagline}</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-sf-text">商品目錄</h1>
          <p className="mt-2 max-w-[60ch] text-[0.9375rem] text-sf-muted">
            {siteBrand.description}
          </p>
        </header>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sf-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋商品名稱、品牌、分類..."
              className="pl-9"
            />
          </div>
        </div>

        {!catLoading && categories && categories.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                categoryId === null
                  ? "border-sf-text bg-sf-text text-sf-paper"
                  : "border-[color:var(--sf-line)] text-sf-muted hover:text-sf-text"
              }`}
            >
              全部
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  categoryId === c.id
                    ? "border-sf-text bg-sf-text text-sf-paper"
                    : "border-[color:var(--sf-line)] text-sf-muted hover:text-sf-text"
                }`}
              >
                {c.name}
                <span className="ml-1 text-xs opacity-60">({c.product_count})</span>
              </button>
            ))}
          </div>
        )}

        {prodLoading ? (
          <div className="py-20 text-center text-sf-muted">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-sf-muted">沒有找到符合的商品</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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

        {isFetching && !prodLoading && (
          <div className="mt-4 text-center text-xs text-sf-muted">更新中...</div>
        )}
      </div>
    </main>
  );
}