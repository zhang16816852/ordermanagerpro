import { ArrowRight } from "lucide-react";
import { ProductMedia } from "@/components/storefront/ProductMedia";
import type { HeroBlock } from "@/storefront/blocks/schema";
import { cn } from "@/lib/utils";

/** 首屏／結尾主視覺。tone='ink' 走反白純文字排版，不放媒體欄。 */
export function Hero({ block }: { block: HeroBlock }) {
  const isInk = block.tone === "ink";
  const centered = block.align === "center";
  // 反白區塊若無媒體圖就只留文字，避免右欄出現一個空的 placeholder 方塊
  const showMedia = !isInk;

  return (
    <section
      className={cn(
        "sf-section",
        isInk ? "bg-sf-inverse text-sf-inverse-text" : "bg-sf-paper text-sf-text"
      )}
    >
      <div className="sf-container">
        <div
          className={cn(
            "grid gap-10",
            showMedia ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-end" : "",
            centered ? "mx-auto max-w-3xl text-center" : ""
          )}
        >
          <div className={cn(centered && "flex flex-col items-center")}>
            {block.eyebrow ? (
              <p className={cn("sf-eyebrow mb-5", isInk && "text-sf-inverse-muted")}>
                {block.eyebrow}
              </p>
            ) : null}

            <h1 className={cn("sf-display", isInk ? "text-sf-inverse-text" : "text-sf-text")}>
              {block.title}
            </h1>

            {block.lead ? (
              <p
                className={cn(
                  "sf-lead mt-6 max-w-[46ch]",
                  centered && "max-w-[52ch]",
                  isInk && "text-sf-inverse-muted"
                )}
              >
                {block.lead}
              </p>
            ) : null}

            {block.primaryCta || block.secondaryCta ? (
              <div
                className={cn(
                  "mt-9 flex flex-wrap items-center gap-x-7 gap-y-3",
                  centered && "justify-center"
                )}
              >
                {block.primaryCta ? (
                  <a
                    href={block.primaryCta.href}
                    className={cn(
                      "sf-link-underline inline-flex items-center gap-2 text-[0.9375rem]",
                      isInk ? "text-sf-inverse-text" : "text-sf-text"
                    )}
                  >
                    {block.primaryCta.label}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : null}
                {block.secondaryCta ? (
                  <a
                    href={block.secondaryCta.href}
                    className={cn(
                      "sf-link-underline text-[0.9375rem]",
                      isInk ? "text-sf-inverse-muted" : "text-sf-muted"
                    )}
                  >
                    {block.secondaryCta.label}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          {showMedia ? (
            <ProductMedia
              src={block.media.src}
              alt={block.media.alt || block.title}
              hue={block.media.hue}
              ratio="landscape"
              priority
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}