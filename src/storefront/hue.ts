/**
 * 由字串穩定推導一個色相（0–359）
 * ------------------------------------------------------------
 * 用在「沒有商品圖」的 placeholder 上：讓每個商品卡片的漸層色相不同，
 * 在全站只有 1 個產品有圖的狀態下，版面才不會看起來像壞掉或全部一樣。
 * 刻意放在獨立檔案，讓 ProductMedia.tsx 只 export 元件（react-refresh 規範）。
 */
export function hueFromSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}