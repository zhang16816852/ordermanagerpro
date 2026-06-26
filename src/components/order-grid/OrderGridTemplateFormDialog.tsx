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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { OrderGridDimensionPicker } from './OrderGridDimensionPicker';
import { OrderGridProductPicker } from './OrderGridProductPicker';
import { GridPreviewSidebar } from './GridPreviewSidebar';
import { buildGridMatrix } from '@/lib/order-grid-utils';
import { Eye, EyeOff } from 'lucide-react';
import type {
  OrderGridTemplateWithProducts,
  DimensionConfig,
} from '@/types/order-grid';
import type { ProductWithPricing } from '@/types/product';

interface OrderGridTemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: OrderGridTemplateWithProducts | null;
  products: ProductWithPricing[];
  onSave: (data: {
    name: string;
    description?: string;
    row_config: DimensionConfig;
    col_config: DimensionConfig;
    tab_config?: DimensionConfig | null;
    variant_ids: string[];
  }) => void;
  isLoading?: boolean;
}

const defaultRowConfig: DimensionConfig = {
  type: 'variant_field',
  label: 'Row',
  field: 'option_1',
};

const defaultColConfig: DimensionConfig = {
  type: 'variant_field',
  label: 'Column',
  field: 'option_2',
};

export function OrderGridTemplateFormDialog({
  open,
  onOpenChange,
  template,
  products,
  onSave,
  isLoading,
}: OrderGridTemplateFormDialogProps) {
  const isEditing = !!template?.id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rowConfig, setRowConfig] = useState<DimensionConfig>(defaultRowConfig);
  const [colConfig, setColConfig] = useState<DimensionConfig>(defaultColConfig);
  const [useTab, setUseTab] = useState(false);
  const [tabConfig, setTabConfig] = useState<DimensionConfig>({
    type: 'variant_field',
    label: 'Tab',
    field: 'option_3',
  });
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || '');
      setRowConfig(template.row_config);
      setColConfig(template.col_config);
      setUseTab(!!template.tab_config);
      if (template.tab_config) {
        setTabConfig(template.tab_config);
      }
      setVariantIds(
        template.template_variants?.map((tv) => tv.variant_id) || []
      );
    } else {
      setName('');
      setDescription('');
      setRowConfig(defaultRowConfig);
      setColConfig(defaultColConfig);
      setUseTab(false);
      setTabConfig({
        type: 'variant_field',
        label: 'Tab',
        field: 'option_3',
      });
      setVariantIds([]);
    }
  }, [template, open]);

  const selectedProducts = useMemo(() => {
    const variantSet = new Set(variantIds);
    return products
      .filter(p => (p.variants || []).some((v: any) => variantSet.has(v.id)))
      .map(p => ({
        ...p,
        variants: (p.variants || []).filter((v: any) => variantSet.has(v.id)),
      }));
  }, [products, variantIds]);

  const grid = useMemo(() => {
    if (selectedProducts.length === 0) return null;
    try {
      const result = buildGridMatrix(
        {
          row_config: rowConfig,
          col_config: colConfig,
          tab_config: useTab ? tabConfig : null,
        },
        selectedProducts
      );
      return result;
    } catch (e) {
      console.error('[Grid Dialog] buildGridMatrix error:', e);
      return null;
    }
  }, [selectedProducts, rowConfig, colConfig, useTab, tabConfig]);

  const isValid =
    name.trim() &&
    rowConfig.label.trim() &&
    colConfig.label.trim() &&
    variantIds.length > 0;

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      row_config: rowConfig,
      col_config: colConfig,
      tab_config: useTab ? tabConfig : null,
      variant_ids: variantIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>
            {isEditing ? '編輯範本' : '新增範本'}
          </DialogTitle>
          <DialogDescription>
            設定 table 式下單的維度與產品變體
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-0 overflow-hidden">
          {/* Left Column: Config */}
          <div className="w-full lg:w-[380px] shrink-0 border-r px-6 py-4 space-y-5 overflow-y-auto">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>範本名稱 *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：保護貼系列"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>描述</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="選填"
                  rows={2}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="text-sm font-medium">維度設定</h4>
              <div className="space-y-3">
                <div className="border rounded-lg p-3">
                  <OrderGridDimensionPicker
                    value={rowConfig}
                    onChange={setRowConfig}
                    label="Row 維度"
                  />
                </div>
                <div className="border rounded-lg p-3">
                  <OrderGridDimensionPicker
                    value={colConfig}
                    onChange={setColConfig}
                    label="Column 維度"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="use-tab"
                  checked={useTab}
                  onCheckedChange={setUseTab}
                />
                <Label htmlFor="use-tab" className="text-sm">
                  啟用 Tab 維度（3D）
                </Label>
              </div>

              {useTab && (
                <div className="border rounded-lg p-3">
                  <OrderGridDimensionPicker
                    value={tabConfig}
                    onChange={setTabConfig}
                    label="Tab 維度"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Middle: Product Picker */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium">選擇產品變體 *</h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewOpen(!previewOpen)}
                  className="h-8 text-xs gap-1.5"
                >
                  {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {previewOpen ? '隱藏預覽' : '預覽'}
                </Button>
              </div>
              <OrderGridProductPicker
                selectedVariantIds={variantIds}
                onChange={setVariantIds}
                products={products}
              />
            </div>
          </div>

          {/* Right Sidebar: Grid Preview */}
          <GridPreviewSidebar
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            grid={grid}
            rowLabel={rowConfig.label}
            colLabel={colConfig.label}
          />
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            取消
          </Button>
          <Button onClick={handleSave} disabled={!isValid || isLoading}>
            {isLoading ? '儲存中...' : '儲存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
