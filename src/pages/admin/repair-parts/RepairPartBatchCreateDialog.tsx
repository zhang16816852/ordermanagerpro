import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import {
  useRepairParts,
  useRepairPartMutations,
  useRepairPartProductOptions,
  RepairPartInput,
} from '@/hooks/useRepairParts';

interface RepairPartBatchCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DraftRow {
  product_id: string;
  product_name: string;
  links: { product_id: string; variant_id: string | null; spec_label: string | null; is_default: boolean }[];
  name: string;
  deviceModelId: string | null;
  selected: boolean;
}

/** 依「維修零件商品」批次建立型錄零件：每個商品一筆零件，其所有變體作為規格連結 */
export function RepairPartBatchCreateDialog({ open, onOpenChange }: RepairPartBatchCreateDialogProps) {
  const { options } = useRepairPartProductOptions();
  const { parts } = useRepairParts();
  const { createMutation } = useRepairPartMutations();
  const { data: models } = useDeviceModels();

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [keyword, setKeyword] = useState('');

  const modelOptions = useMemo(() => models.map(m => ({ id: m.id, name: m.name })), [models]);

  // 已存在型錄連結的 product_id + variant_id 組合
  const covered = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => p.links.forEach(l => set.add(`${l.product_id}|${l.variant_id || ''}`)));
    return set;
  }, [parts]);

  useEffect(() => {
    if (!open) return;
    const byProduct = new Map<string, DraftRow>();
    options.forEach(o => {
      if (covered.has(`${o.product_id}|${o.variant_id || ''}`)) return;
      let row = byProduct.get(o.product_id);
      if (!row) {
        row = {
          product_id: o.product_id,
          product_name: o.product_name,
          links: [],
          name: o.product_name,
          deviceModelId: null,
          selected: true,
        };
        byProduct.set(o.product_id, row);
      }
      row.links.push({
        product_id: o.product_id,
        variant_id: o.variant_id,
        spec_label: o.variant_name,
        is_default: row.links.length === 0,
      });
    });
    setRows(Array.from(byProduct.values()));
    setKeyword('');
  }, [open, options, covered]);

  const visible = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.product_name.toLowerCase().includes(q) || r.links.some(l => (l.spec_label || '').toLowerCase().includes(q)));
  }, [rows, keyword]);

  const selectedCount = rows.filter(r => r.selected && r.name.trim()).length;
  const noModelCount = rows.filter(r => r.selected && !r.deviceModelId).length;

  const patch = (productId: string, next: Partial<DraftRow>) => {
    setRows(prev => prev.map(r => (r.product_id === productId ? { ...r, ...next } : r)));
  };

  const handleSubmit = async () => {
    const targets = rows.filter(r => r.selected && r.name.trim() && r.links.length > 0);
    if (targets.length === 0) {
      toast.error('請至少勾選一項零件並填寫名稱');
      return;
    }
    let created = 0;
    const failed: string[] = [];
    for (const row of targets) {
      const payload: RepairPartInput = {
        device_model_id: row.deviceModelId,
        name: row.name.trim(),
        tags: [],
        description: null,
        supplier_id: null,
        default_unit_cost: 0,
        default_unit_price: 0,
        is_active: true,
        sort_order: 0,
        links: row.links,
      };
      try {
        await createMutation.mutateAsync(payload);
        created += 1;
      } catch {
        failed.push(row.name.trim());
      }
    }
    if (failed.length > 0) {
      toast.error(`已建立 ${created} 筆，失敗 ${failed.length} 筆：${failed.join('、')}`, { duration: 6000 });
    } else {
      toast.success(`已建立 ${created} 筆零件型錄`);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批次建立零件型錄</DialogTitle>
          <DialogDescription>
            列出尚未綁定型錄的維修零件商品，可一次建立多筆「零件名稱 × 商品連結」。多變體商品會自動建立規格連結。
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            所有維修零件商品都已建立型錄項目。
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋商品名稱"
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={() => setRows(prev => prev.map(r => ({ ...r, selected: true })))}
              >
                全選
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={() => setRows(prev => prev.map(r => ({ ...r, selected: false })))}
              >
                全不選
              </Button>
            </div>

            <div className="space-y-2">
              {visible.map(row => (
                <div key={row.product_id} className="rounded-md border p-2.5 flex items-start gap-2.5">
                  <Checkbox
                    className="mt-1.5"
                    checked={row.selected}
                    onCheckedChange={(c) => patch(row.product_id, { selected: !!c })}
                    aria-label={`選擇 ${row.product_name}`}
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={row.name}
                        onChange={(e) => patch(row.product_id, { name: e.target.value })}
                        placeholder="零件名稱"
                        className="h-8 w-full max-w-[220px] text-sm"
                      />
                      <div className="w-full sm:w-52">
                        <SearchableSelect
                          options={modelOptions}
                          value={row.deviceModelId}
                          onChange={(id) => patch(row.product_id, { deviceModelId: id || null })}
                          placeholder="適用型號（留空＝通用）"
                          searchPlaceholder="搜尋型號"
                          clearable
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="truncate">{row.product_name}</span>
                      {row.links.map((l, i) => (
                        <Badge key={`${l.variant_id || 'p'}-${i}`} variant="outline" className="text-[10px] font-normal">
                          {l.spec_label || '無變體'}
                          {l.is_default && ' ・預設'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              {visible.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">查無符合「{keyword}」的商品</p>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            將建立 {selectedCount} 筆
            {noModelCount > 0 && `，其中 ${noModelCount} 筆為通用零件（未選型號）`}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || selectedCount === 0}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            建立
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
