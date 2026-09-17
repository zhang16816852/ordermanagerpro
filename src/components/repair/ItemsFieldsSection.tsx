import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Package, Wrench, Truck } from 'lucide-react';
import { RepairPartSelect } from '@/components/repair/RepairPartSelect';
import { RepairBatchSelect } from '@/components/repair/RepairBatchSelect';
import { DeviceBlock, RepairBlockItem, BlockUpdateProps, createEmptyBlockItem } from './deviceBlockTypes';

export interface ItemsFieldsSectionProps extends BlockUpdateProps {
  mode?: 'admin' | 'store';
  onCreatePart?: (deviceModelId: string | null) => void;
  onNavigateToPurchase?: () => void;
  onRequestPurchase?: (block: DeviceBlock) => void;
}

export function ItemsFieldsSection({
  block,
  onChange,
  mode = 'admin',
  onCreatePart,
  onNavigateToPurchase,
  onRequestPurchase,
}: ItemsFieldsSectionProps) {
  const updateItem = (itemId: string, field: string, value: any) => {
    onChange({
      ...block,
      items: block.items.map(i => i.id === itemId ? { ...i, [field]: value } : i),
    });
  };

  const updateItemFields = (itemId: string, patch: Partial<RepairBlockItem>) => {
    onChange({
      ...block,
      items: block.items.map(i => i.id === itemId ? { ...i, ...patch } : i),
    });
  };

  const addItem = (type: 'part' | 'service' = 'part') => {
    onChange({ ...block, items: [...block.items, createEmptyBlockItem(type)] });
  };

  const removeItem = (itemId: string) => {
    onChange({ ...block, items: block.items.filter(i => i.id !== itemId) });
  };

  return (
    <CardContent className="space-y-3">
      {block.items.length === 0 ? (
        <div className="text-center py-6 border border-dashed rounded-lg bg-muted/20">
          <p className="text-sm text-muted-foreground mb-3">尚未新增維修項目或材料</p>
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => addItem('part')}
              className="gap-1.5 shadow-sm"
            >
              <Package className="h-4 w-4" />
              新增零件
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addItem('service')}
              className="gap-1.5"
            >
              <Wrench className="h-4 w-4" />
              新增服務
            </Button>
          </div>
        </div>
      ) : (
        <div className="hidden md:grid grid-cols-12 gap-2 px-3 text-xs font-medium text-muted-foreground select-none">
          <div className={mode === 'admin' ? "col-span-6" : "col-span-8"}>項目名稱 / 零件材料</div>
          <div className="col-span-1 text-center">數量</div>
          {mode === 'admin' && <div className="col-span-2 text-right pr-2">成本</div>}
          <div className="col-span-2 text-right pr-2">{mode === 'admin' ? '售價' : '價格'}</div>
          <div className="col-span-1 text-right">操作</div>
        </div>
      )}

      {block.items.map((item) => (
        <div key={item.id} className="space-y-2 p-3 border rounded-lg bg-muted/10 transition-colors hover:border-border/80">
          {/* 第一行：產品名稱(寬) + 數量 + 成本(寬) + 售價(寬) + 操作 */}
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center">
            {/* 名稱 / 零件材料欄位：極致寬敞，佔 6 欄（Store 佔 8 欄） */}
            <div className={cn(
              "col-span-2 min-w-0 flex items-center gap-1.5",
              mode === 'admin' ? "md:col-span-6" : "md:col-span-8"
            )}>
              <Badge
                variant={item.item_type === 'part' ? 'default' : 'secondary'}
                className="h-7 px-2 text-[11px] font-normal cursor-pointer select-none shrink-0"
                title="點擊切換為服務/零件"
                onClick={() => {
                  const nextType = item.item_type === 'part' ? 'service' : 'part';
                  if (nextType === 'service') {
                    updateItemFields(item.id, {
                      item_type: 'service',
                      purchase_order_item_id: null,
                      product_id: null,
                      variant_id: null,
                    });
                  } else {
                    updateItem(item.id, 'item_type', 'part');
                  }
                }}
              >
                {item.item_type === 'part' ? '零件' : '服務'}
              </Badge>

              {item.purchase_order_item_id && (
                <Badge
                  variant="outline"
                  className="h-6 px-1.5 text-[10px] text-green-600 border-green-300 dark:text-green-400 gap-0.5 shrink-0 select-none"
                  title="此零件已向供應商叫料（已建立採購單）"
                >
                  <Truck className="h-3 w-3" />
                  已叫料
                </Badge>
              )}

              <div className="flex-1 min-w-0">
                {item.item_type === 'part' ? (
                  <RepairPartSelect
                    value={{
                      product_id: item.product_id,
                      variant_id: item.variant_id,
                      part_name: item.part_name || item.service_name || '',
                      unit_cost: item.unit_cost,
                    }}
                    onCreatePart={onCreatePart ? () => onCreatePart(block.device_model_id || null) : undefined}
                    onSelect={(sel) => {
                      if (!sel) {
                        updateItemFields(item.id, {
                          product_id: null,
                          variant_id: null,
                          part_name: '',
                          service_name: '',
                          purchase_order_item_id: null,
                        });
                        return;
                      }
                      updateItemFields(item.id, {
                        product_id: sel.product_id,
                        variant_id: sel.variant_id,
                        part_name: sel.part_name,
                        service_name: sel.part_name,
                        unit_cost: sel.unit_cost,
                        purchase_order_item_id: null,
                      });
                    }}
                  />
                ) : (
                  <Input
                    value={item.service_name}
                    onChange={(e) => updateItem(item.id, 'service_name', e.target.value)}
                    placeholder="服務名稱（例如：工資、檢測、清潔）"
                    className="h-9 text-sm"
                  />
                )}
              </div>
            </div>

            {/* 數量 */}
            <div className="col-span-1 md:col-span-1 min-w-0">
              <Input
                type="number"
                value={item.quantity}
                onChange={(e) => updateItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                min={1}
                className="h-9 text-sm text-center"
                title="數量"
              />
            </div>

            {/* 成本 (Admin)：擴展至 2 欄，不再吃字 */}
            {mode === 'admin' && (
              <div className="col-span-1 md:col-span-2 min-w-0">
                <Input
                  type="number"
                  value={item.unit_cost}
                  onChange={(e) => updateItem(item.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                  placeholder="成本"
                  className="h-9 text-sm text-right font-medium"
                  title="成本"
                />
              </div>
            )}

            {/* 售價：擴展至 2 欄，不再吃字 */}
            <div className="col-span-1 md:col-span-2 min-w-0">
              <Input
                type="number"
                value={item.unit_price}
                onChange={(e) => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                placeholder={mode === 'admin' ? '售價' : '價格'}
                className="h-9 text-sm text-right font-medium text-primary"
                title={mode === 'admin' ? '售價' : '價格'}
              />
            </div>

            {/* 刪除操作 */}
            <div className="col-span-1 md:col-span-1 flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => removeItem(item.id)}
                aria-label="刪除品項"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 第二行：描述說明（獨立一整行）+ 零件進貨批次與扣庫存狀態 */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1.5 border-t border-border/40 text-xs">
            <div className="flex-1 min-w-0">
              <Input
                value={item.description}
                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                placeholder="詳細描述 / 備註說明（選填）"
                className="h-8 text-xs bg-background/50 placeholder:text-muted-foreground/60"
              />
            </div>

            {item.item_type === 'part' && (item.product_id || item.variant_id) && (
              <div className="flex items-center gap-2 shrink-0">
                {mode === 'admin' && (
                  <div className="flex items-center gap-1.5">
                    <Label className="shrink-0 text-xs text-muted-foreground">批次:</Label>
                    <div className="w-44 min-w-0">
                      <RepairBatchSelect
                        productId={item.product_id}
                        variantId={item.variant_id}
                        value={item.purchase_order_item_id}
                        onPick={(batch) => {
                          updateItemFields(item.id, {
                            purchase_order_item_id: batch.id,
                            unit_cost: batch.unit_cost,
                          });
                        }}
                        onClear={() => updateItem(item.id, 'purchase_order_item_id', null)}
                      />
                    </div>
                  </div>
                )}
                <Badge variant={item.is_stock_deducted ? 'default' : 'outline'} className="text-[10px] shrink-0">
                  {item.is_stock_deducted ? '已扣庫存' : '未扣庫存'}
                </Badge>
              </div>
            )}
          </div>
        </div>
      ))}

      {block.items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => addItem('part')}
              className="gap-1.5 shadow-sm"
            >
              <Package className="h-4 w-4" />
              新增零件
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addItem('service')}
              className="gap-1.5"
            >
              <Wrench className="h-4 w-4" />
              新增服務
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'admin' && onCreatePart && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground text-xs"
                onClick={() => onCreatePart(block.device_model_id || null)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                建立零件商品
              </Button>
            )}
            {mode === 'admin' && (onRequestPurchase || onNavigateToPurchase) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground text-xs"
                onClick={() => onRequestPurchase ? onRequestPurchase(block) : onNavigateToPurchase?.()}
                title="叫料 / 進貨"
              >
                <Truck className="h-3.5 w-3.5 mr-1" />
                叫料/進貨
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === 'admin' && block.items.some(i => i.item_type === 'part' && i.product_id) && (
        <p className="text-xs text-muted-foreground">
          由零件挑選器選擇的零件料號會於儲存後自動扣減自有倉庫庫存。
        </p>
      )}
    </CardContent>
  );
}