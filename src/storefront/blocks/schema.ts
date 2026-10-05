import { z } from "zod";

/**
 * Storefront 區塊 schema
 * ------------------------------------------------------------
 * 首頁 = 一份 block 清單。每個 block 都有 zod schema 與獨立元件，
 * 後台編輯器日後只需操作這份 JSON（見 AGENTS.md「首頁重構」）。
 *
 * 設計原則：版面與字級由元件寫死，後台只負責「挑選 + 填內容 + 排序」。
 * 這是為了保住排版控制權；若開放任意間距/字級滑桿，視覺品質會退化。
 */

const ctaSchema = z.object({
  label: z.string().trim().min(1),
  href: z.string().trim().min(1),
});

/**
 * 所有 block 共用的錨點欄位。
 *
 * 為什麼由 block 自己宣告、而不是由 nav 去猜位置：
 * 首頁的區塊順序是資料驅動的（後台編輯器可拖曳排序），若把「#categories」
 * 綁在第 N 個區塊上，重新排序後連結就會指向錯的內容。
 * block 帶 anchor、nav 只寫 href，兩者靠字串約定，排序後連結依然正確。
 *
 * 命名限制：會成為 URL fragment，故只允許小寫字母、數字與連字號。
 */
const anchorField = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "anchor 僅能使用小寫字母、數字與連字號")
  .min(1)
  .optional();

const mediaSchema = z.object({
  /** Storage 路徑；null 代表走刻意的無圖狀態（漸層 placeholder） */
  src: z.string().trim().min(1).nullable().default(null),
  alt: z.string().trim().default(""),
  /**
   * 無圖狀態的色相（0-360）。
   * 讓每個區塊的 placeholder 不會長得一樣，同時避免圖片未補上時版面像壞掉。
   */
  hue: z.number().int().min(0).max(360).default(30),
});

export const heroBlockSchema = z.object({
  type: z.literal("hero"),
  enabled: z.boolean().default(true),
  anchor: anchorField,
  eyebrow: z.string().trim().default(""),
  title: z.string().trim().min(1),
  lead: z.string().trim().default(""),
  primaryCta: ctaSchema.nullable().default(null),
  secondaryCta: ctaSchema.nullable().default(null),
  media: mediaSchema.default({ src: null, alt: "", hue: 28 }),
  align: z.enum(["left", "center"]).default("left"),
  /** paper = 暖白底 + 墨色字；ink = 反白深色區塊 */
  tone: z.enum(["paper", "ink"]).default("paper"),
});

export const categoryRailBlockSchema = z.object({
  type: z.literal("categoryRail"),
  enabled: z.boolean().default(true),
  anchor: anchorField,
  eyebrow: z.string().trim().default(""),
  title: z.string().trim().default(""),
  /** categories.id（uuid 字串）。
   * 空陣列 = 依商品數自動取前 N 個分類（v1 預設，圖片/價格都還沒補齊時最穩）；
   * 填入 id 則為人工指定，未命到的會被靜默略過。
   * ⚠️ 用 id 而非 slug：categories.slug 全站 37 筆皆為 NULL 且從未被使用。 */
  categoryIds: z.array(z.string().trim()).default([]),
  /** columns 只影響寬螢幕 */
  columns: z.number().int().min(2).max(6).default(4),
});

export const featuredProductsBlockSchema = z.object({
  type: z.literal("featuredProducts"),
  enabled: z.boolean().default(true),
  anchor: anchorField,
  eyebrow: z.string().trim().default(""),
  title: z.string().trim().default(""),
  lead: z.string().trim().default(""),
  source: z
    .object({
      kind: z.enum(["category", "handpicked"]),
      /** kind='category' 時使用；空字串 = 不依分類過濾 */
      categoryId: z.string().trim().default(""),
      /** kind='handpicked' 時使用，product id (uuid) */
      productIds: z.array(z.string().trim()).default([]),
    })
    .default({ kind: "category", categoryId: "", productIds: [] }),
  layout: z.enum(["grid", "rail"]).default("grid"),
  columns: z.number().int().min(2).max(5).default(4),
  limit: z.number().int().min(1).max(24).default(8),
});

export const statementBlockSchema = z.object({
  type: z.literal("statement"),
  enabled: z.boolean().default(true),
  anchor: anchorField,
  eyebrow: z.string().trim().default(""),
  text: z.string().trim().min(1),
  attribution: z.string().trim().default(""),
});

export const blockSchema = z.discriminatedUnion("type", [
  heroBlockSchema,
  categoryRailBlockSchema,
  featuredProductsBlockSchema,
  statementBlockSchema,
]);

export type HeroBlock = z.infer<typeof heroBlockSchema>;
export type CategoryRailBlock = z.infer<typeof categoryRailBlockSchema>;
export type FeaturedProductsBlock = z.infer<typeof featuredProductsBlockSchema>;
export type StatementBlock = z.infer<typeof statementBlockSchema>;
export type StorefrontBlock = z.infer<typeof blockSchema>;
export type BlockType = StorefrontBlock["type"];

export const storefrontPageSchema = z.object({
  blocks: z.array(blockSchema),
});

/**
 * 後台編輯器需要的區塊中繼資料（label 用於選單顯示）。
 * 未來新增 block type 時，這裡與 registry 同步擴充即可。
 */
export const BLOCK_META: Record<BlockType, { label: string; hint: string }> = {
  hero: { label: "主視覺", hint: "頁面最上方的標題、說明與主按鈕" },
  categoryRail: { label: "分類導覽", hint: "挑選要顯示的商品分類" },
  featuredProducts: { label: "精選商品", hint: "依分類或手動挑選商品" },
  statement: { label: "引言文字", hint: "一段大字的編輯式版面" },
};