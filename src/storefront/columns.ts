/**
 * columns（2–6）→ Tailwind 靜態 class map
 * ------------------------------------------------------------
 * 為什麼不用 inline style 或 `grid-cols-${n}`：
 * 1. inline style 會在手機也強迫 N 欄，沒有響應式；
 * 2. `grid-cols-${n}` 是動態字串，Tailwind JIT 掃不到會被 purge 成無效 class。
 * 所以只能列舉成靜態字串（schema 已限制 columns 為 2–6 的整數）。
 */
const COLUMN_CLASSES: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

export function columnsClass(columns: number): string {
  return COLUMN_CLASSES[columns] ?? COLUMN_CLASSES[4];
}