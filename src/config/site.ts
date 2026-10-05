import { storefrontPageSchema } from "@/storefront/blocks/schema";

/**
 * 品牌與首頁內容的「可替換槽位」
 * ------------------------------------------------------------
 * 這是編輯器尚未建立前的內容來源。日後後台上線時，只需要把
 * `defaultBlocks` 換成從 `storefront_pages` 讀回的 JSON，
 * renderer（StorefrontPage）與所有 block 元件都不用動。
 *
 * ⚠️ 不要在 block 元件裡硬寫品牌名、文案或價格 —— 全部走這裡。
 */

/** 品牌資訊。換品牌時只改這個物件。 */
export const siteBrand = {
  /** 顯示名稱，同時用於 header、footer 與瀏覽器標題後綴 */
  name: "ordermanager",
  /** 一句話定位，用於 meta description 與 footer */
  tagline: "手機與 3C 通路用品選物",
  description:
    "玻璃保護貼、鏡頭保護貼、手機殼、藍寶石鏡頭貼與行動電源 —— 通路用配件一次齊。",
  /**
   * 導覽列連結。href 目前為錨點，未來 /shop 上線後改成真路由。
   * ⚠️ 錨點字串必須與下方 block 的 `anchor` 欄位一致，
   *    StorefrontPage 會把它做成 wrapper 的 id。
   */
  nav: [
    { label: "商品分類", href: "#categories" },
    { label: "精選商品", href: "#featured" },
    { label: "關於我們", href: "#about" },
  ],
  /** 已登入者的「進入工作台」按鈕 */
  workspaceLabel: "進入工作台",
  /** 未登入者的按鈕 */
  signInLabel: "登入",
} as const;

export type SiteBrand = typeof siteBrand;

/**
 * 首頁預設 block 清單
 * ------------------------------------------------------------
 * 只放 4 種區塊，刻意不追求種類多。每一種在頁面上都有明確角色：
 *
 *   1. hero(paper)        —— 首屏：說明這裡賣什麼
 *   2. categoryRail       —— 依商品數自動取前 8 個分類（圖片未補齊前最穩）
 *   3. featuredProducts   —— 主要陳列帶（依分類取）
 *   4. statement          —— 編輯式引言，打斷商品節奏
 *   5. featuredProducts   —— 次要陳列帶（rail 版，寬螢幕橫向捲動）
 *   6. hero(ink)          —— 結尾行動呼籲，反白收尾
 */
export const defaultBlocks = [
  {
    type: "hero",
    enabled: true,
    eyebrow: "通路用配件 · 一次齊",
    title: "保護貼與機殼，\n照通路尺寸備貨",
    lead:
      "玻璃保護貼、鏡頭保護貼、手機殼、藍寶石鏡頭貼到行動電源，都是店裡真的會賣的規格。",
    primaryCta: { label: "看商品分類", href: "#categories" },
    secondaryCta: { label: "直接看精選", href: "#featured" },
    media: { src: null, alt: "", hue: 28 },
    align: "left",
    tone: "paper",
  },
  {
    type: "categoryRail",
    enabled: true,
    anchor: "categories",
    eyebrow: "依分類瀏覽",
    title: "先從你賣的品類找起",
    categoryIds: [],
    columns: 4,
  },
  {
    type: "featuredProducts",
    enabled: true,
    anchor: "featured",
    eyebrow: "主力陳列",
    title: "藍寶石鏡頭貼",
    lead: "鏡頭保護裡最高價位的一檔，先看這裡。",
    // categories.id = 藍寶石鏡頭貼
    // 實測：去重後前 8 個「不同產品」有 7 個有零售價（8 張卡不會開天窗）
    source: { kind: "category", categoryId: "c0346cba-45bf-4f6f-9de4-d2b4b9de6069", productIds: [] },
    layout: "grid",
    columns: 4,
    limit: 8,
  },
  {
    type: "statement",
    enabled: true,
    anchor: "about",
    eyebrow: "",
    text: "配件這種東西，客人不問規格、只問會不會破、會不會翹。剩下的交給品項齊不齊。",
    attribution: "",
  },
  {
    type: "featuredProducts",
    enabled: true,
    eyebrow: "主力品類",
    title: "玻璃保護貼",
    lead: "在售 215 個品項，數量最多的類別。",
    // categories.id = 玻璃保護貼（215 個在售品項）
    source: { kind: "category", categoryId: "1cda6b00-0bc4-46fc-a66a-42f5486bc267", productIds: [] },
    layout: "rail",
    columns: 4,
    limit: 6,
  },
  {
    type: "hero",
    enabled: true,
    eyebrow: "",
    title: "要建立通路自己的\n商品頁？",
    lead: "這份型錄是公開的，進到工作台就能管理品項、庫存與訂單。",
    primaryCta: { label: "登入", href: "/auth" },
    secondaryCta: null,
    media: { src: null, alt: "", hue: 200 },
    align: "left",
    tone: "ink",
  },
] as const;

/**
 * 以 schema 驗證預設 block 清單。
 * 用 safeParse 而非 parse：內容寫錯時降級成極簡首頁並在 console 報錯，
 * 而不是讓整個 App 在載入階段白畫面。
 */
const fallbackBlocks = [
  { type: "hero", enabled: true, title: siteBrand.name, lead: siteBrand.tagline },
];

function loadBlocks() {
  const parsed = storefrontPageSchema.safeParse({ blocks: defaultBlocks });
  if (parsed.success) return parsed.data.blocks;
  console.error(
    "[storefront] defaultBlocks 未通過 schema 驗證，已降級為極簡首頁：",
    parsed.error.issues,
  );
  const fb = storefrontPageSchema.safeParse({ blocks: fallbackBlocks });
  return fb.success ? fb.data.blocks : [];
}

/** 首頁 block 清單（已套用 schema defaults）。日後改由後台／DB 提供。 */
export const storefrontBlocks = loadBlocks();