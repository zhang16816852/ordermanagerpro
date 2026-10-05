import { Hero } from "./Hero";
import { CategoryRail } from "./CategoryRail";
import { FeaturedProducts } from "./FeaturedProducts";
import { Statement } from "./Statement";
import type { StorefrontBlock } from "./schema";

/**
 * Block 清單渲染器
 * ------------------------------------------------------------
 * 刻意用 switch 而不是 registry 物件：
 * switch 讓 TypeScript 依 discriminated union (`type` literal) 自動收窄，
 * 每個 block 拿到的是「自己那個 type 的完整型別」，不會退化成 any。
 * 若改成 Record<BlockType, ComponentType<{block: StorefrontBlock}>>，
 * 內部欄位就要全部 optional 或硬轉 any，反而更容易出錯。
 *
 * ⚠️ 新增 block type 時，這裡與 schema.ts 的 BLOCK_META 必須同步更新。
 */
export function BlockRenderer({ block }: { block: StorefrontBlock }) {
  switch (block.type) {
    case "hero":
      return <Hero block={block} />;
    case "categoryRail":
      return <CategoryRail block={block} />;
    case "featuredProducts":
      return <FeaturedProducts block={block} />;
    case "statement":
      return <Statement block={block} />;
    default: {
      // 型別已窮舉；這裡只為滿足 TS 的 never 檢查，不會真的走到
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}