import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/formatters';

export interface RepairPartBatch {
  id: string;
  purchase_order_id: string;
  unit_cost: number;
  received_date: string | null;
  received_at: string | null;
  remaining: number;
}

export function useRepairPartBatches(productId: string | null, variantId: string | null) {
  return useQuery<RepairPartBatch[]>({
    queryKey: ['repair_part_batches', productId || 'none', variantId || 'none'],
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await (supabase as any).rpc('list_repair_part_batches', {
        p_product_id: productId,
        p_variant_id: variantId,
      });
      if (error) throw error;
      return (data || []) as RepairPartBatch[];
    },
    enabled: !!productId,
  });
}

function batchLabel(b: RepairPartBatch) {
  const date = b.received_date || (b.received_at ? b.received_at.slice(0, 10) : null);
  return `${date || '未標日期'}・${formatCurrency(b.unit_cost)}・剩 ${b.remaining}`;
}

interface RepairBatchSelectProps {
  productId: string | null;
  variantId: string | null;
  value: string | null;
  onPick: (batch: RepairPartBatch) => void;
  onClear: () => void;
}

export function RepairBatchSelect({ productId, variantId, value, onPick, onClear }: RepairBatchSelectProps) {
  const { data: batches = [], isLoading } = useRepairPartBatches(productId, variantId);
  const lastKey = useRef<string | null>(null);

  const key = `${productId || ''}|${variantId || ''}`;

  useEffect(() => {
    if (!productId) return;
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (value && batches.some(b => b.id === value)) {
      const currentBatch = batches.find(b => b.id === value);
      if (currentBatch) onPick(currentBatch);
    } else if (batches.length > 0) {
      onPick(batches[0]);
    } else if (!value) {
      onClear();
    }
  }, [productId, key, batches, value, onPick, onClear]);

  if (isLoading) {
    return <div className="h-9 text-xs text-muted-foreground flex items-center">批次載入中...</div>;
  }

  if (batches.length === 0) {
    return <div className="h-9 text-xs text-muted-foreground flex items-center px-1">無可用進貨批次</div>;
  }

  const currentId = value && batches.some(b => b.id === value) ? value : batches[0].id;

  return (
    <Select
      value={currentId}
      onValueChange={(v) => {
        const b = batches.find(x => x.id === v);
        if (b) onPick(b);
      }}
    >
      <SelectTrigger className="h-9 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {batches.map((b) => (
          <SelectItem key={b.id} value={b.id}>{batchLabel(b)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}