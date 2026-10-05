import { cn } from "@/lib/utils";
import { hueFromSeed } from "@/storefront/hue";

/**
 * 公開店面的媒體框
 * ------------------------------------------------------------
 * 全站目前只有 1 個產品有商品圖，所以「沒有圖」才是預設狀況。
 * 因此這裡刻意不做灰色骨架，而是用極低飽和的紙感漸層 + 一道斜紋，
 * 靠 hue（由 item_slug 雜湊而來）讓不同商品在視覺上仍可區分。
 * 等真的補上圖片，只要塞 src 就會自動蓋掉 placeholder，版面不用改。
 */

type Ratio = "square" | "portrait" | "landscape" | "wide";

const RATIO_CLASS: Record<Ratio, string> = {
  square: "aspect-square",
  portrait: "aspect-[4/5]",
  landscape: "aspect-[3/2]",
  wide: "aspect-[16/9]",
};

type ProductMediaProps = {
  src?: string | null;
  alt: string;
  /** 沒有圖時決定漸層色相；不傳則由 src/alt 推導 */
  hue?: number;
  ratio?: Ratio;
  /** 首屏大圖設 true：eager + fetchpriority，避免 LCP 被 lazy 拖慢 */
  priority?: boolean;
  className?: string;
  /** zoom 為 true 時 hover 會有極輕微的 scale */
  zoom?: boolean;
};

export function ProductMedia({
  src,
  alt,
  hue,
  ratio = "square",
  priority = false,
  className,
  zoom = false,
}: ProductMediaProps) {
  const tone = hue ?? hueFromSeed(alt || "sf");

  return (
    <div
      className={cn(
        "sf-media relative overflow-hidden",
        RATIO_CLASS[ratio],
        zoom && "sf-media-zoom",
        className
      )}
      style={
        src
          ? undefined
          : {
              backgroundImage: `linear-gradient(145deg,
                  hsl(${tone} 20% 93%) 0%,
                  hsl(${(tone + 26) % 360} 16% 87%) 52%,
                  hsl(${(tone + 48) % 360} 22% 91%) 100%)`,
            }
      }
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          // @ts-expect-error fetchpriority 目前不在 React 19 前的型別裡
          fetchpriority={priority ? "high" : "auto"}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        // 沒有圖時疊一層極淡斜紋，避免大面積純色死板
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgb(11 11 12 / 0.028) 0 1px, transparent 1px 7px)",
          }}
        />
      )}
    </div>
  );
}