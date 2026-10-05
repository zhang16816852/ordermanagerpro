import type { StatementBlock } from "@/storefront/blocks/schema";

/** 編輯式大字引言區。用於頁面中段或結尾的一段文字。 */
export function Statement({ block }: { block: StatementBlock }) {
  return (
    <section className="sf-section bg-sf-paper">
      <div className="sf-container">
        <figure className="mx-auto max-w-[40ch] text-center">
          {block.eyebrow ? <p className="sf-eyebrow mb-6">{block.eyebrow}</p> : null}
          <blockquote className="sf-h2 text-sf-text text-balance">{block.text}</blockquote>
          {block.attribution ? (
            <figcaption className="sf-eyebrow mt-7">{block.attribution}</figcaption>
          ) : null}
        </figure>
      </div>
    </section>
  );
}