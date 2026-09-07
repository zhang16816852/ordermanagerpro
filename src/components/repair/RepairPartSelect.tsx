import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import {
  RepairPartSelectDialog,
  RepairPartSelection,
} from '@/components/repair/RepairPartSelectDialog';

export type { RepairPartSelection };

interface RepairPartSelectProps {
  value: RepairPartSelection | null;
  onSelect: (selection: RepairPartSelection | null) => void;
  disabled?: boolean;
  onCreatePart?: () => void;
  placeholder?: string;
}

export function RepairPartSelect({
  value,
  onSelect,
  disabled = false,
  onCreatePart,
  placeholder = '點擊放大鏡選擇零件...',
}: RepairPartSelectProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolvedName, setResolvedName] = useState<string>('');

  const trimmedPartName = value?.part_name?.trim() || '';
  const hasSelected = !!(value?.product_id || value?.variant_id || trimmedPartName.length > 0);

  // 若只有 product_id 但無 part_name，自動向資料庫查詢補齊產品名稱
  useEffect(() => {
    if ((value?.product_id || value?.variant_id) && !trimmedPartName) {
      let isMounted = true;

      const resolve = async () => {
        // 優先用 variant_id 直接查變體（含 product 名稱）
        if (value.variant_id) {
          const { data: vData } = await (supabase.from('product_variants' as any) as any)
            .select('name, wholesale_price, product:product_id(name)')
            .eq('id', value.variant_id)
            .maybeSingle();
          if (!isMounted) return;
          if (vData) {
            const vName = vData.name || '';
            const pName = vData.product?.name || '';
            const fullName = vName || pName || '零件材料';
            setResolvedName(fullName);
            onSelect({
              product_id: value.product_id,
              variant_id: value.variant_id,
              part_name: fullName,
              unit_cost: value.unit_cost || Number(vData.wholesale_price || 0),
            });
            return;
          }
        }
        // fallback：用 product_id 查主商品
        if (value.product_id) {
          const { data } = await (supabase.from('products' as any) as any)
            .select('name, variants:product_variants(id, name, wholesale_price)')
            .eq('id', value.product_id)
            .maybeSingle();
          if (!isMounted || !data) return;
          const variant = value.variant_id
            ? (data.variants || []).find((v: any) => v.id === value.variant_id)
            : null;
          const pName = data.name || '零件材料';
          const vName = variant?.name || '';
          const fullName = vName || pName;
          setResolvedName(fullName);
          onSelect({
            product_id: value.product_id,
            variant_id: value.variant_id,
            part_name: fullName,
            unit_cost: value.unit_cost || Number(variant?.wholesale_price || 0),
          });
        }
      };

      resolve();
      return () => { isMounted = false; };
    }
  }, [value?.product_id, value?.variant_id, trimmedPartName]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPartName = trimmedPartName || resolvedName || '';

  return (
    <div className="flex items-center gap-1.5 w-full min-w-0">
      {/* 零件名稱區域：分最多空間，自適應佔滿全部剩餘寬度 */}
      <Input
        value={currentPartName}
        onChange={(e) => {
          const nextName = e.target.value;
          setResolvedName(nextName);
          onSelect({
            product_id: value?.product_id || null,
            variant_id: value?.variant_id || null,
            part_name: nextName,
            unit_cost: value?.unit_cost || 0,
          });
        }}
        placeholder="零件名稱"
        title={currentPartName || '零件名稱'}
        disabled={disabled}
        className="h-9 text-sm font-medium flex-1 min-w-0"
      />

      {/* 僅保留放大鏡圖示按鈕，無任何按鈕文字，懸停時才顯示提示 */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        onClick={() => setDialogOpen(true)}
        title={currentPartName ? '點擊更換零件' : '點擊放大鏡選擇零件'}
      >
        <Search className="h-4 w-4" />
      </Button>

      <RepairPartSelectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentValue={value ? { product_id: value.product_id, variant_id: value.variant_id } : null}
        onSelect={(sel) => {
          setResolvedName(sel.part_name);
          onSelect(sel);
        }}
        onCreatePart={onCreatePart}
      />
    </div>
  );
}