import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePublicProducts } from "@/storefront/usePublicCatalog";
import { siteBrand } from "@/config/site";

export default function ShopProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();

  const { data: items, isLoading, error } = usePublicProducts({
    productIds: productId ? [productId] : undefined,
    limit: 100,
    distinctProducts: false,
  });

  const product = items?.[0];
  const variants = useMemo(() => items ?? [], [items]);

  const prices = useMemo(
    () => variants.map((v) => v.retail_price).filter((p): p is number => p != null && p > 0),
    [variants],
  );
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  if (isLoading) {
    return (
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="sf-container py-20 text-center text-sf-muted">載入中...</div>
      </main>
    );
  }

  if (error || !product) {
    return (
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="sf-container py-20 text-center">
          <p className="text-sf-muted">找不到此商品</p>
          <Link to="/shop" className="mt-4 inline-block text-sm text-sf-text underline">
            返回商品目錄
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <div className="sf-container py-10">
        <Link
          to="/shop"
          className="inline-flex items-center gap-1 text-sm text-sf-muted hover:text-sf-text"
        >
          <ArrowLeft className="h-4 w-4" /> 返回商品目錄
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <div className="aspect-square overflow-hidden rounded-xl border border-[color:var(--sf-line)] bg-sf-paper flex items-center justify-center">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.product_name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-sm text-sf-muted/40">No Image</span>
            )}
          </div>

          <div>
            {product.brand_name && (
              <span className="sf-eyebrow">{product.brand_name}</span>
            )}
            <h1 className="mt-2 text-2xl font-medium tracking-tight text-sf-text">
              {product.product_name}
            </h1>
            {product.category_name && (
              <p className="mt-1 text-sm text-sf-muted">分類：{product.category_name}</p>
            )}

            <div className="mt-4">
              {minPrice != null ? (
                <span className="text-2xl font-semibold text-sf-text">
                  {minPrice === maxPrice
                    ? "$" + minPrice.toLocaleString()
                    : "$" + minPrice.toLocaleString() + " – $" + maxPrice!.toLocaleString()}
                </span>
              ) : (
                <span className="text-sm text-sf-muted">價格洽詢</span>
              )}
            </div>

            {variants.length > 1 && (
              <div className="mt-6">
                <h2 className="text-sm font-medium text-sf-text">規格 / 機型</h2>
                <ul className="mt-2 divide-y divide-[color:var(--sf-line)] rounded-lg border border-[color:var(--sf-line)]">
                  {variants.map((v) => (
                    <li
                      key={v.item_id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sf-text">
                          {v.variant_name && v.variant_name !== v.product_name
                            ? v.variant_name
                            : v.model_name || "標準規格"}
                        </div>
                        {v.variant_sku && (
                          <div className="truncate text-[0.6875rem] text-sf-muted/70">SKU: {v.variant_sku}</div>
                        )}
                        {v.model_name && v.variant_name && v.variant_name !== v.product_name && (
                          <div className="truncate text-xs text-sf-muted">{v.model_name}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {v.retail_price != null ? (
                          <span className="font-medium text-sf-text">
                            ${Number(v.retail_price).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-xs text-sf-muted">洽詢</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-8 text-xs text-sf-muted">
              {siteBrand.name} · {siteBrand.tagline}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}