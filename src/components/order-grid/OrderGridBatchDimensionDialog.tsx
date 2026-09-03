import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { OrderGridDimensionPicker } from './OrderGridDimensionPicker';
import type { OrderGridTemplateWithProducts, DimensionConfig } from '@/types/order-grid';
import type { ProductWithPricing } from '@/types/product';

interface OrderGridBatchDimensionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾選的範本（各自的變體會被用來過濾群組/規格選項） */
  selectedTemplates: OrderGridTemplateWithProducts[];
  /** 全域產品（從中依各範本變體篩出共用的維度選項來源） */
  products: ProductWithPricing[];
  onConfirm: (data: {
    row_config: DimensionConfig;
    col_config: DimensionConfig;
    tab_config?: DimensionConfig | null;
    optionGroupNames?: Record<'row' | 'col' | 'tab', string | null>;
  }) => void;
  isLoading?: boolean;
}

const defaultRow: DimensionConfig = {
  type: 'variant_field',
  label: 'Row',
  field: '',
};

const defaultCol: DimensionConfig = {
  type: 'variant_field',
  label: 'Column',
  field: '',
};

const defaultTab: DimensionConfig = {
  type: 'variant_field',
  label: 'Tab',
  field: '',
};

export function OrderGridBatchDimensionDialog({
  open,
  onOpenChange,
  selectedTemplates,
  products,
  onConfirm,
  isLoading,
}: OrderGridBatchDimensionDialogProps) {
  const [rowConfig, setRowConfig] = useState<DimensionConfig>(defaultRow);
  const [colConfig, setColConfig] = useState<DimensionConfig>(defaultCol);
  const [useTab, setUseTab] = useState(false);
  const [tabConfig, setTabConfig] = useState<DimensionConfig>(defaultTab);

  // 取「勾選範本」所有變體對應的產品交集子集，當作維度選項（群組/規格）的來源
  const commonProducts = useMemo(() => {
    if (selectedTemplates.length === 0) return [];
    const variantIds = new Set<string>();
    selectedTemplates.forEach((t) => {
      (t.template_variants || []).forEach((tv) => variantIds.add(tv.variant_id));
    });
    const productIds = new Set<string>();
    products.forEach((p) => {
      (p.variants || []).forEach((v: any) => {
        if (variantIds.has(v.id)) productIds.add(p.id);
      });
    });
    if (productIds.size === 0) return [];
    return products
      .filter((p) => productIds.has(p.id))
      .map((p) => ({
        ...p,
        variants: (p.variants || []).filter((v: any) => variantIds.has(v.id)),
      }));
  }, [selectedTemplates, products]);

  // option_group_id → 名稱（在共同產品中解析）
  const optionGroupNameMap = useMemo(() => {
    const map = new Map<string, string>();
    commonProducts.forEach((p) => {
      (((p as any).option_groups) || []).forEach((og: any) => {
        if (og.id && og.name) map.set(og.id, og.name);
      });
    });
    return map;
  }, [commonProducts]);

  useEffect(() => {
    if (open) {
      setRowConfig(defaultRow);
      setColConfig(defaultCol);
      setUseTab(false);
      setTabConfig(defaultTab);
    }
  }, [open]);

  const isValid =
    rowConfig.label.trim() &&
    colConfig.label.trim() &&
    (useTab ? !!tabConfig.label.trim() : true);

  const messages = useMemo(() => {
    const list: string[] = [];
    if (selectedTemplates.length === 0) return list;
    if (commonProducts.length === 0) {
      list.push('勾選的範本沒有可在已載入產品中找到的變體');
    } else {
      const variantCount = new Set(
        selectedTemplates.flatMap((t) => (t.template_variants || []).map((tv) => tv.variant_id)),
      ).size;
      list.push(`下列維度設定會套用到 ${selectedTemplates.length} 個範本`);
      list.push(`維度「值」依各範本自己的變體產生（可不同）`);
      list.push(`選項群組／規格下拉僅列出勾選範本變體實際用到的項目（共 ${variantCount} 個變體）`);
    }
    return list;
  }, [selectedTemplates, commonProducts]);

  const hasCommonProducts = commonProducts.length > 0;

  const handleConfirm = () => {
    if (!isValid || !hasCommonProducts) return;
    const nameOf = (cfg: DimensionConfig): string | null =>
      cfg.type === 'option' && cfg.option_group_id
        ? optionGroupNameMap.get(cfg.option_group_id) || null
        : null;
    onConfirm({
      row_config: rowConfig,
      col_config: colConfig,
      tab_config: useTab ? tabConfig : null,
      optionGroupNames: {
        row: nameOf(rowConfig),
        col: nameOf(colConfig),
        tab: useTab ? nameOf(tabConfig) : null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批次修改維度欄位</DialogTitle>
          <DialogDescription>
            {selectedTemplates.length > 0
              ? `將下列維度設定套用到已勾選的 ${selectedTemplates.length} 個範本`
              : '請先勾選要修改的範本'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border p-3 bg-muted/40 text-xs text-muted-foreground">
          {messages.length > 0 ? (
            messages.map((m) => <div key={m}>• {m}</div>)
          ) : (
            <div>尚未勾選任何範本</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="border rounded-lg p-3 space-y-3">
            <Label className="text-sm font-medium">Row 維度</Label>
            <OrderGridDimensionPicker
              value={rowConfig}
              onChange={setRowConfig}
              label="Row 維度"
              products={hasCommonProducts ? commonProducts : undefined}
            />
          </div>

          <div className="border rounded-lg p-3 space-y-3">
            <Label className="text-sm font-medium">Col 維度</Label>
            <OrderGridDimensionPicker
              value={colConfig}
              onChange={setColConfig}
              label="Column 維度"
              products={hasCommonProducts ? commonProducts : undefined}
            />
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Switch
              id="batch-use-tab"
              checked={useTab}
              onCheckedChange={setUseTab}
            />
            <Label htmlFor="batch-use-tab" className="text-sm">
              啟用 Tab 維度（3D）
            </Label>
          </div>

          {useTab && (
            <div className="border rounded-lg p-3 space-y-3">
              <Label className="text-sm font-medium">Tab 維度</Label>
              <OrderGridDimensionPicker
                value={tabConfig}
                onChange={setTabConfig}
                label="Tab 維度"
                products={hasCommonProducts ? commonProducts : undefined}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isValid || !hasCommonProducts || isLoading}
          >
            {isLoading ? '套用中...' : '套用到全部'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

