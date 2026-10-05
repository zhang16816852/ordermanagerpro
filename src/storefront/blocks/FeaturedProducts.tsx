import { usePublicProducts, type PublicProduct } from "@/storefront/usePublicCatalog";
import { columnsClass } from "@/storefront/columns";
import { ProductMedia } from "@/components/storefront/ProductMedia";
import { hueFromSeed } from "@/storefront/hue";
import type { FeaturedProductsBlock } from "@/storefront/blocks/schema";
import { formatTWD } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * 商品卡
 * ------------------------------------------------------------
 * 資料現實：`storefront_items` 是「產品 × 變體 × 機型」矩陣，所以同一個
 * 產品會有多列（例：CITYBOSS 5D 軍規殼有 6 個變體都適配 IP11）。
 *
 * 去重層級：usePublicProducts 預設 distinctProducts=true，請 RPC 以
 * DISTINCT ON (product_id) 每個產品只回一列 —— 否則「取前 N 列」會被
 * 字母序最前的那個產品整包霸佔，畫面變成一排重複卡片。
 * 但「同一產品的不同變體／機型」仍是辨識商品所必需的線索，
 * 因此這張卡同時呈現 product_name / variant_name / model_name 三層。
 */
function ProductCard({ item, ratio }: { item: PublicProduct; ratio: "square" | "portrait" }) {
  // 變體名若已被商品名涵蓋就省略副標，避免同一句話講兩次
  const showVariant =
    !!item.variant_name &&
    item.variant_name !== item.product_name &&
    !item.product_name.includes(item.variant_name);

  const hasPrice = item.retail_price !== null && item.retail_price > 0;

  return (
    <article className="group">
      <ProductMedia
        src={item.image_url}
        alt={item.product_name}
        hue={hueFromSeed(item.item_slug)}
        ratio={ratio}
        zoom
      />

      <div className="mt-4 space-y-1.5">
        {item.brand_name ? <p className="sf-eyebrow">{item.brand_name}</p> : null}

        <h3 className="text-[0.9375rem] leading-snug text-sf-text">
          {/* 兩行截斷，避免 38 字元的變體名把版面撐開 */}
          <span className="line-clamp-2">{item.product_name}</span>
        </h3>

        {showVariant ? (
          <p className="line-clamp-1 text-[0.8125rem] text-sf-muted">{item.variant_name}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          {item.model_name ? (
            <span className="rounded-full border border-[color:var(--sf-line)] px-2.5 py-0.5 text-[0.75rem] text-sf-muted">
              {item.model_name}
            </span>
          ) : null}
          {hasPrice ? (
            <span className="text-[0.875rem] text-sf-text">{formatTWD(item.retail_price!)}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function FeaturedProducts({ block }: { block: FeaturedProductsBlock }) {
  const { data, isLoading, isError } = usePublicProducts({
    categoryId: block.source.kind === "category" ? block.source.categoryId : undefined,
    productIds: block.source.kind === "handpicked" ? block.source.productIds : undefined,
    limit: block.limit,
  });

  const items = data ?? [];

  // 查詢失敗就整個區塊隱藏：寧可少一區，也不要在首頁留一個錯誤訊息
  if (isError) return null;

  return (
    <section className="sf-section bg-sf-paper">
      <div className="sf-container">
        <header className="mb-10 max-w-[62ch]">
          {block.eyebrow ? <p className="sf-eyebrow mb-4">{block.eyebrow}</p> : null}
          {block.title ? <h2 className="sf-h2 text-sf-text">{block.title}</h2> : null}
          {block.lead ? <p className="sf-lead mt-4">{block.lead}</p> : null}
        </header>

        {isLoading ? (
          <div
            className={cn("grid gap-x-6 gap-y-12", columnsClass(block.columns))}
            aria-hidden="true"
          >
            {Array.from({ length: Math.min(block.limit, block.columns * 2) }).map((_, i) => (
              <div key={i}>
                <div className="sf-media w-full rounded-sm" style={{ aspectRatio: "4 / 5" }} />
                <div className="mt-4 h-3 w-2/3 rounded-full bg-[color:var(--sf-placeholder-a)]" />
                <div className="mt-2 h-3 w-1/3 rounded-full bg-[color:var(--sf-placeholder-a)]" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="sf-eyebrow">此分類目前沒有可公開顯示的商品。</p>
        ) : block.layout === "rail" ? (
          // rail = 橫向捲動；用 CSS scroll-snap 讓手機滑動有定位感
          <div className="-mx-[var(--sf-gutter)] flex snap-x snap-mandatory gap-6 overflow-x-auto px-[var(--sf-gutter)] pb-2">
            {items.map((item) => (
              <div
                key={item.item_id}
                className="w-[min(78vw,20rem)] shrink-0 snap-start"
              >
                <ProductCard item={item} ratio="square" />
              </div>
            ))}
          </div>
        ) : (
          <div className={cn("grid gap-x-6 gap-y-12", columnsClass(block.columns))}>
            {items.map((item) => (
              <ProductCard key={item.item_id} item={item} ratio="portrait" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}