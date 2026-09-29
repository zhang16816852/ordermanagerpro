import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { LotInput, TrackingMode } from '@/utils/lotTracking';

interface LotInputFieldsProps {
  trackingMode: TrackingMode;
  /** serial 模式所需序號數（= 本次收貨數量） */
  quantity: number;
  defaultUnitCost?: number;
  value: LotInput | null;
  onChange: (value: LotInput | null) => void;
}

export function LotInputFields({ trackingMode, quantity, defaultUnitCost, value, onChange }: LotInputFieldsProps) {
  const [serialText, setSerialText] = useState<string>(value?.mode === 'serial' ? value.serials.join('\n') : '');

  useEffect(() => {
    if (value?.mode !== 'serial') return;
    setSerialText(value.serials.join('\n'));
  }, [value]);

  if (trackingMode === 'none') return null;

  if (trackingMode === 'serial') {
    const serials = value?.mode === 'serial' ? value.serials : [];
    const missing = quantity - serials.length;
    const filled = serials.length;
    const complete = filled === quantity;
    return (
      <div className="mt-1 space-y-1">
        <Label className="text-[11px] text-muted-foreground">序號（每行一支，共需 {quantity} 支）</Label>
        <Textarea
          value={serialText}
          onChange={(e) => {
            setSerialText(e.target.value);
            onChange({ mode: 'serial', serials: parseSerials(e.target.value) });
          }}
          rows={Math.min(4, Math.max(1, quantity))}
          placeholder={'序號\n'.repeat(Math.min(3, quantity)).replace(/\n$/, '')}
          className={cn('text-xs font-mono resize-y', !complete && 'border-rose-300')}
        />
        <div className={cn('flex items-center gap-1 text-[11px]', complete ? 'text-emerald-600' : 'text-amber-600')}>
          {complete ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          <span>{complete ? '序號齊全' : `已輸入 ${filled} / ${quantity} 支${missing > 0 ? `，尚缺 ${missing} 支` : ''}`}</span>
        </div>
      </div>
    );
  }

  const batch = value?.mode === 'batch' ? value : null;
  return (
    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">批號</Label>
        <Input
          value={batch?.batch_number ?? ''}
          onChange={(e) =>
            onChange({
              mode: 'batch',
              batch_number: e.target.value,
              unit_cost: batch?.unit_cost ?? defaultUnitCost,
            })
          }
          placeholder="輸入批號"
          className={cn('h-8 text-xs', !batch?.batch_number?.trim() && 'border-rose-300')}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">批次成本（選填）</Label>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={batch?.unit_cost ?? ''}
          placeholder={defaultUnitCost ? `預設 ${defaultUnitCost}` : '沿用品項成本'}
          onChange={(e) =>
            onChange({
              mode: 'batch',
              batch_number: batch?.batch_number ?? '',
              unit_cost: e.target.value === '' ? undefined : parseFloat(e.target.value),
            })
          }
          className="h-8 text-xs text-right"
        />
      </div>
    </div>
  );
}

function parseSerials(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}