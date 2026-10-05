import { BlockRenderer } from "./blocks/BlockRenderer";
import { storefrontBlocks } from "@/config/site";

/**
 * 公開首頁
 * ------------------------------------------------------------
 * 內容來自 src/config/site.ts（經 zod safeParse）。日後換成後端 JSON 時，
 * 只要換掉 storefrontBlocks 這一個 import，這支元件不用動。
 *
 * 錨點由這裡統一套在 wrapper 上（而非各 block 內部），原因有兩個：
 * 1. 部分 block 在查詢失敗或無資料時會 `return null`（見 CategoryRail），
 *    若把 id 放在 block 內部，nav 的連結就會變成找不到目標的死連結。
 * 2. block 順序可被後台編輯器改動，id 跟著 block 走才不會指錯區塊。
 *
 * scroll-mt-16 = 對應 header 的 h-16，讓錨點定位時不被 sticky header 蓋住。
 */
export default function StorefrontPage() {
  const blocks = storefrontBlocks.filter((b) => b.enabled);

  return (
    <main id="main" tabIndex={-1} className="outline-none">
      {blocks.map((block, i) => (
        <div key={`${block.type}-${i}`} id={block.anchor} className={block.anchor ? "scroll-mt-16" : undefined}>
          <BlockRenderer block={block} />
        </div>
      ))}
    </main>
  );
}