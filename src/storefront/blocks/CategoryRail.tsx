import { usePublicCategories, type PublicCategory } from "@/storefront/usePublicCatalog";
import { columnsClass } from "@/storefront/columns";
import type { CategoryRailBlock } from "@/storefront/blocks/schema";
import { cn } from "@/lib/utils";

/**
 * 分類導覽
 * ------------------------------------------------------------
 * 目前刻意「不」做成可點擊：/shop 商品列表頁還不存在，做成連結會是死路。
 * 等 /shop 上線後，把 <li> 換成 <Link to={`/shop?category=${c.id}`}> 即可，
 * 篩選邏輯（categoryIds 指定 or 自動取前 N）不用動。
 */
export function CategoryRail({ block }: { block: CategoryRailBlock }) {
  const { data, isLoading, isError } = usePublicCategories();

  if (isError) return null;

  const all: PublicCategory[] = data ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));

  const picked = block.categoryIds.length
    ? // 人工指定：依設定順序，並靜默略過查無此 id 的（避免壞掉的設定讓整條 rail 空白）
      block.categoryIds.map((id) => byId.get(id)).filter((c): c is PublicCategory => !!c)
    : // 自動：取商品數最多的前 N 個
      [...all].sort((a, b) => b.product_count - a.product_count).slice(0, block.columns * 2);

  if (isLoading) {
    return (
      <div className="sf-section bg-sf-paper">
        <div className="sf-container">
          <div className="h-px w-full bg-[color:var(--sf-line)]" />
        </div>
      </div>
    );
  }

  if (picked.length === 0) return null;

  return (
    <section className="sf-section bg-sf-paper">
      <div className="sf-container">
        <header className="mb-10">
          {block.eyebrow ? <p className="sf-eyebrow mb-4">{block.eyebrow}</p> : null}
          {block.title ? <h2 className="sf-h2 text-sf-text">{block.title}</h2> : null}
        </header>

        <ul
          className={cn(
            "grid gap-px overflow-hidden rounded-sm border border-[color:var(--sf-line)] bg-[color:var(--sf-line)]",
            columnsClass(block.columns)
          )}
        >
          {picked.map((c) => (
            <li key={c.id} className="bg-sf-surface">
              <div className="flex h-full flex-col justify-between gap-8 p-6 sm:p-7">
                <span className="sf-h3 text-sf-text">{c.name}</span>
                <span className="sf-eyebrow">{c.product_count} 項在售</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}