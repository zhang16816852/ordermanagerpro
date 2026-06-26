import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { extractVariantFieldSummary } from '@/lib/order-grid-utils';
import { VARIANT_FIELD_LABELS } from '@/types/order-grid';
import type { VariantFieldKey } from '@/types/order-grid';
import type { ProductWithPricing } from '@/types/product';

interface VariantSummaryPanelProps {
  products: ProductWithPricing[];
  selectedVariantIds: string[];
}

export function VariantSummaryPanel({
  products,
  selectedVariantIds,
}: VariantSummaryPanelProps) {
  const [open, setOpen] = useState(true);
  const selectedSet = useMemo(() => new Set(selectedVariantIds), [selectedVariantIds]);

  const selectedProducts = useMemo(() => {
    return products
      .filter(p => (p.variants || []).some((v: any) => selectedSet.has(v.id)))
      .map(p => ({
        ...p,
        variants: (p.variants || []).filter((v: any) => selectedSet.has(v.id)),
      }));
  }, [products, selectedSet]);

  const variantSummary = useMemo(
    () => extractVariantFieldSummary(selectedProducts),
    [selectedProducts]
  );

  if (Object.keys(variantSummary).length === 0) return null;

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        可用維度值摘要
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {(Object.entries(variantSummary) as [VariantFieldKey, string[]][]).map(
            ([field, values]) => (
              <div key={field} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0 w-20">
                  {VARIANT_FIELD_LABELS[field]}:
                </span>
                <div className="flex flex-wrap gap-1">
                  {values.map((v) => (
                    <Badge key={v} variant="outline" className="text-[10px] px-1.5 py-0">
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
