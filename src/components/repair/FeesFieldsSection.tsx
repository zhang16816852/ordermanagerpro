import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { ModelPickerOption } from '@/components/repair/ModelPicker';
import { DeviceBlock, BlockUpdateProps, calcBlockTotals } from './deviceBlockTypes';

export interface FeesFieldsSectionProps extends BlockUpdateProps {
  mode?: 'admin' | 'store';
}

export function FeesFieldsSection({ block, onChange, mode = 'admin' }: FeesFieldsSectionProps) {
  const { partsCost, laborFee, totalPrice } = calcBlockTotals(block);
  const set = (patch: Partial<DeviceBlock>) => onChange({ ...block, ...patch });
  return (
    <CardContent className="space-y-3">
      {mode === 'admin' && (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">零件成本</span>
            <span className="font-mono">{formatCurrency(partsCost)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">工資（估）</span>
            <span className="font-mono">{formatCurrency(laborFee)}</span>
          </div>
        </>
      )}
      {mode === 'admin' && (
        <div className="flex justify-between text-sm items-center">
          <span className="text-muted-foreground">折扣</span>
          <Input
            type="number"
            value={block.discount}
            onChange={(e) => set({ discount: parseFloat(e.target.value) || 0 })}
            className="w-24 h-7 text-right text-sm"
          />
        </div>
      )}
      <div className="flex justify-between text-sm items-center">
        <span className="text-muted-foreground">已收定金</span>
        <Input
          type="number"
          value={block.deposit}
          onChange={(e) => set({ deposit: parseFloat(e.target.value) || 0 })}
          className="w-24 h-7 text-right text-sm"
        />
      </div>
      <hr />
      <div className="flex justify-between font-semibold">
        <span>應收總額</span>
        <span className="font-mono text-lg">{formatCurrency(totalPrice)}</span>
      </div>
      {mode === 'admin' && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">毛利（估）</span>
          <span className={cn('font-mono', totalPrice - partsCost >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(totalPrice - partsCost)}
          </span>
        </div>
      )}
    </CardContent>
  );
}

export function DeviceBlockSummaryCard({ block, models, index }: { block: DeviceBlock; models: ModelPickerOption[]; index?: number }) {
  const { partsCost, laborFee, totalPrice } = calcBlockTotals(block);
  const modelName = models.find((m) => m.id === block.device_model_id)?.name;
  return (
    <div className="p-2 border rounded-lg bg-muted/10 space-y-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{index !== undefined ? `機 ${index + 1}・` : ''}{modelName || '未選型號'}</span>
        <span className="font-mono">{formatCurrency(totalPrice)}</span>
      </div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>零件成本 {formatCurrency(partsCost)} ・ 工資 {formatCurrency(laborFee)}</span>
        <span className="text-[10px]">項目 {block.items.length} ・ 零件 {block.items.filter(i => i.item_type === 'part').length}</span>
      </div>
    </div>
  );
}