import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SupplierProductMapping } from '../../hooks/useSupplierMappings';
import { MappingFieldDiff, costTextOf, targetTextOf } from './mappingDiff';

/**
 * 逐欄顯示「原始值 → 變更後值」。
 * 呼叫端只應傳入 changed === true 的欄位（沒變動的欄位不顯示）。
 */
export function MappingDiffList({ rows }: { rows: MappingFieldDiff[] }) {
  if (rows.length === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">無變更，內容與資料庫相同</p>;
  }
  return (
    <dl className="mt-1 space-y-0.5 text-xs">
      {rows.map(diff => (
        <div key={diff.label} className="flex flex-wrap items-baseline gap-1">
          <dt className="shrink-0 text-muted-foreground">{diff.label}</dt>
          <dd className="flex flex-wrap items-baseline gap-1">
            <span className="text-muted-foreground line-through">{diff.before}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium text-amber-600 dark:text-amber-400">{diff.after}</span>
            <Badge
              variant="outline"
              className="border-amber-500/50 px-1 py-0 text-[10px] text-amber-600 dark:text-amber-400"
            >
              將變更
            </Badge>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 資料庫既有對照（原始資料）清單，供「新增對照目標」情境對照 */
export function ExistingTargetsList({ rows }: { rows: SupplierProductMapping[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      <p className="text-muted-foreground">資料庫既有對照（{rows.length} 筆）：</p>
      <ul className="space-y-0.5 text-muted-foreground">
        {rows.map(m => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-1">
            <span>
              {targetTextOf(m.internal_product?.name, m.internal_variant?.name, m.internal_product?.code)}
            </span>
            {m.is_primary && (
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">主對照</Badge>
            )}
            <span>・單價 {costTextOf(m.vendor_unit_cost)}</span>
            {m.vendor_product_name && <span>・{m.vendor_product_name}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}