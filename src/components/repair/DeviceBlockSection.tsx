import { useState } from 'react';
import { ChevronDown, Smartphone, Plus, Trash2, DollarSign, ClipboardCheck, Truck, Package, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { ModelPicker, ModelPickerOption } from '@/components/repair/ModelPicker';
import { LockInput, DeviceLockType } from '@/components/repair/LockInput';
import { ChecklistEditor, ChecklistItem } from '@/components/repair/ChecklistEditor';
import { RepairPartSelect } from '@/components/repair/RepairPartSelect';
import { RepairBatchSelect } from '@/components/repair/RepairBatchSelect';

export interface RepairBlockItem {
  id: string;
  item_type: 'service' | 'part';
  service_name: string;
  part_name: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_cost: number;
  unit_price: number;
  description: string;
  is_stock_deducted: boolean;
  purchase_order_item_id: string | null;
}

export interface DeviceBlock {
  key: string;
  device_model_id: string;
  device_color: string;
  device_storage: string;
  device_ram: string;
  device_cpu: string;
  device_imei: string;
  device_sn: string;
  device_lock_type: DeviceLockType;
  device_passcode: string;
  device_passcode_pattern: string;
  device_condition: string;
  reported_issue: string;
  diagnostic_result: string;
  internal_notes: string;
  items: RepairBlockItem[];
  appearanceChecklist: ChecklistItem[];
  functionalChecklist: ChecklistItem[];
  discount: number;
  deposit: number;
}

export function createEmptyDeviceBlock(): DeviceBlock {
  return {
    key: crypto.randomUUID(),
    device_model_id: '',
    device_color: '',
    device_storage: '',
    device_ram: '',
    device_cpu: '',
    device_imei: '',
    device_sn: '',
    device_lock_type: 'none',
    device_passcode: '',
    device_passcode_pattern: '',
    device_condition: '',
    reported_issue: '',
    diagnostic_result: '',
    internal_notes: '',
    items: [],
    appearanceChecklist: [],
    functionalChecklist: [],
    discount: 0,
    deposit: 0,
  };
}

export function createEmptyBlockItem(type: 'part' | 'service' = 'part'): RepairBlockItem {
  return {
    id: crypto.randomUUID(),
    item_type: type,
    service_name: '',
    part_name: '',
    product_id: null,
    variant_id: null,
    quantity: 1,
    unit_cost: 0,
    unit_price: 0,
    description: '',
    is_stock_deducted: false,
    purchase_order_item_id: null,
  };
}

export function calcBlockTotals(block: DeviceBlock) {
  const partsCost = block.items.filter(i => i.item_type === 'part').reduce((s, i) => s + (i.unit_cost * i.quantity), 0);
  const laborFee = block.items.filter(i => i.item_type === 'service').reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const gross = block.items.reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const totalPrice = Math.max(0, gross - block.discount);
  return { partsCost, laborFee, gross, totalPrice };
}

export interface BlockUpdateProps {
  block: DeviceBlock;
  onChange: (block: DeviceBlock) => void;
}

export interface DeviceFieldsSectionProps extends BlockUpdateProps {
  models: ModelPickerOption[];
  showRam?: boolean;
  showSn?: boolean;
}

export function DeviceFieldsSection({ block, onChange, models, showRam = true, showSn = true }: DeviceFieldsSectionProps) {
  const selectedModel = models.find((m) => m.id === block.device_model_id);
  const selectedModelSpecs = selectedModel?.specifications || {};
  const modelVersions: any[] = Array.isArray(selectedModelSpecs.versions) ? selectedModelSpecs.versions : [];
  const set = (patch: Partial<DeviceBlock>) => onChange({ ...block, ...patch });

  const handleModelChange = (modelId: string | null) => {
    set({
      device_model_id: modelId || '',
      device_color: '',
      device_storage: '',
      device_ram: '',
      device_cpu: '',
    });
  };

  const applyVersion = (version: any) => {
    if (!version) return;
    set({
      device_color: version.color || '',
      device_storage: version.storage || '',
      device_ram: version.ram || '',
      device_cpu: version.cpu || '',
    });
  };

  return (
    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2 md:col-span-2">
        <Label>型號</Label>
        <ModelPicker
          models={models}
          value={block.device_model_id || null}
          onChange={handleModelChange}
        />
        {modelVersions.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Label className="shrink-0 text-xs text-muted-foreground">快速套用版本</Label>
            <Select value="" onValueChange={(v) => applyVersion(modelVersions.find((ver) => ver.version_name === v))}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue placeholder="選擇版本組合..." />
              </SelectTrigger>
              <SelectContent>
                {modelVersions.map((ver) => (
                  <SelectItem key={ver.version_name} value={ver.version_name}>
                    {ver.version_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label>顏色</Label>
        {selectedModelSpecs.colors?.length ? (
          <Select value={block.device_color} onValueChange={(v) => set({ device_color: v })}>
            <SelectTrigger>
              <SelectValue placeholder="選擇顏色..." />
            </SelectTrigger>
            <SelectContent>
              {(selectedModelSpecs.colors as string[]).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={block.device_color} onChange={(e) => set({ device_color: e.target.value })} placeholder="例: 太空黑" />
        )}
      </div>
      <div className="space-y-2">
        <Label>儲存空間</Label>
        {selectedModelSpecs.storage_options?.length ? (
          <Select value={block.device_storage} onValueChange={(v) => set({ device_storage: v })}>
            <SelectTrigger>
              <SelectValue placeholder="選擇容量..." />
            </SelectTrigger>
            <SelectContent>
              {(selectedModelSpecs.storage_options as string[]).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={block.device_storage} onChange={(e) => set({ device_storage: e.target.value })} placeholder="例: 256GB" />
        )}
      </div>
      {showRam && (
        <div className="space-y-2">
          <Label>RAM</Label>
          {selectedModelSpecs.ram_options?.length ? (
            <Select value={block.device_ram} onValueChange={(v) => set({ device_ram: v })}>
              <SelectTrigger>
                <SelectValue placeholder="選擇 RAM..." />
              </SelectTrigger>
              <SelectContent>
                {(selectedModelSpecs.ram_options as string[]).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={block.device_ram} onChange={(e) => set({ device_ram: e.target.value })} placeholder="例: 8GB" />
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label>CPU</Label>
        {selectedModelSpecs.cpu_options?.length ? (
          <Select value={block.device_cpu} onValueChange={(v) => set({ device_cpu: v })}>
            <SelectTrigger>
              <SelectValue placeholder="選擇 CPU..." />
            </SelectTrigger>
            <SelectContent>
              {(selectedModelSpecs.cpu_options as string[]).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value={block.device_cpu} onChange={(e) => set({ device_cpu: e.target.value })} placeholder="例: A17 Pro" />
        )}
      </div>
      <div className="space-y-2">
        <Label>IMEI</Label>
        <Input value={block.device_imei} onChange={(e) => set({ device_imei: e.target.value })} placeholder="IMEI 號碼" />
      </div>
      {showSn && (
        <div className="space-y-2">
          <Label>序號 (SN)</Label>
          <Input value={block.device_sn} onChange={(e) => set({ device_sn: e.target.value })} placeholder="序號" />
        </div>
      )}
      <div className="space-y-2 md:col-span-2">
        <LockInput
          lockType={block.device_lock_type}
          onLockTypeChange={(t) => set({ device_lock_type: t })}
          passcode={block.device_passcode}
          onPasscodeChange={(code) => set({ device_passcode: code })}
          pattern={block.device_passcode_pattern}
          onPatternChange={(pattern) => set({ device_passcode_pattern: pattern })}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>外觀狀況</Label>
        <Input value={block.device_condition} onChange={(e) => set({ device_condition: e.target.value })} placeholder="例: 螢幕破裂、背蓋有刮痕" />
      </div>
    </CardContent>
  );
}

export function DeviceBlockCardTitle({ block, index, models }: { block: DeviceBlock; index: number; models: ModelPickerOption[] }) {
  const modelName = models.find((m) => m.id === block.device_model_id)?.name;
  return (
    <CardTitle className="flex items-center gap-2 text-base">
      <Smartphone className="h-4 w-4 shrink-0" />
      <span className="shrink-0">裝置區塊 {index + 1}</span>
      {modelName && (
        <Badge variant="outline" className="text-xs font-normal truncate max-w-[200px]">{modelName}</Badge>
      )}
    </CardTitle>
  );
}

export interface IssuesFieldsSectionProps extends BlockUpdateProps {
  showDiagnostic?: boolean;
  showInternalNotes?: boolean;
}

export function IssuesFieldsSection({ block, onChange, showDiagnostic = true, showInternalNotes = true }: IssuesFieldsSectionProps) {
  const set = (patch: Partial<DeviceBlock>) => onChange({ ...block, ...patch });
  return (
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <Label>客戶描述問題</Label>
        <Textarea value={block.reported_issue} onChange={(e) => set({ reported_issue: e.target.value })} rows={3} placeholder="客戶描述的故障情況..." />
      </div>
      {showDiagnostic && (
        <div className="space-y-2">
          <Label>檢測結果</Label>
          <Textarea value={block.diagnostic_result} onChange={(e) => set({ diagnostic_result: e.target.value })} rows={3} placeholder="工程師檢測結果..." />
        </div>
      )}
      {showInternalNotes && (
        <div className="space-y-2">
          <Label>內部備註</Label>
          <Textarea value={block.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} rows={2} placeholder="不顯示在收據上的內部備註..." />
        </div>
      )}
    </CardContent>
  );
}

export interface ChecklistFieldsSectionProps extends BlockUpdateProps {
  suggestions: { appearance: string[]; functional: string[] };
}

export function ChecklistFieldsSection({ block, onChange, suggestions }: ChecklistFieldsSectionProps) {
  return (
    <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-2">
        <Label>外觀檢查</Label>
        <ChecklistEditor
          category="appearance"
          title="外觀檢查"
          items={block.appearanceChecklist}
          onItemsChange={(items) => onChange({ ...block, appearanceChecklist: items })}
          suggestions={suggestions.appearance}
        />
      </div>
      <div className="space-y-2">
        <Label>功能檢查</Label>
        <ChecklistEditor
          category="functional"
          title="功能檢查"
          items={block.functionalChecklist}
          onItemsChange={(items) => onChange({ ...block, functionalChecklist: items })}
          suggestions={suggestions.functional}
        />
      </div>
    </CardContent>
  );
}

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

export interface DeviceBlockSectionProps {
  block: DeviceBlock;
  index: number;
  total: number;
  models: ModelPickerOption[];
  mode?: 'admin' | 'store';
  collapsed?: boolean;
  suggestions: { appearance: string[]; functional: string[] };
  onUpdate: (block: DeviceBlock) => void;
  onAddBlock: () => void;
  onRemoveBlock: (key: string) => void;
  onCreatePart?: (deviceModelId: string | null) => void;
  onNavigateToPurchase?: () => void;
  onRequestPurchase?: (block: DeviceBlock) => void;
}

export function DeviceBlockSection({
  block,
  index,
  total,
  models,
  mode = 'admin',
  collapsed = false,
  suggestions,
  onUpdate,
  onAddBlock,
  onRemoveBlock,
  onCreatePart,
  onNavigateToPurchase,
  onRequestPurchase,
}: DeviceBlockSectionProps) {
  const [open, setOpen] = useState(!collapsed);
  const showRemove = total > 1;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <DeviceBlockCardTitle block={block} index={index} models={models} />
        <div className="flex items-center gap-1">
          {showRemove && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onRemoveBlock(block.key)} aria-label="移除裝置區塊">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(o => !o)} aria-label={open ? '收合區塊' : '展開區塊'}>
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </CardHeader>
      {open && (
        <>
          <DeviceFieldsSection block={block} onChange={onUpdate} models={models} showRam={mode === 'admin'} showSn={mode === 'admin'} />
          <div className="px-6 pb-1">
            <div className="border-t" />
          </div>
          <IssuesFieldsSection
            block={block}
            onChange={onUpdate}
            showDiagnostic={mode === 'admin'}
            showInternalNotes={mode === 'admin'}
          />
          <div className="px-6 pb-1">
            <div className="border-t" />
          </div>
          <div className="px-6 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-semibold">
                <ClipboardCheck className="h-4 w-4" />
                外觀 / 功能檢查
              </div>
              <span className="text-xs text-muted-foreground">
                已勾選 {block.appearanceChecklist.filter(c => c.is_checked).length + block.functionalChecklist.filter(c => c.is_checked).length}
              </span>
            </div>
          </div>
          <ChecklistFieldsSection block={block} onChange={onUpdate} suggestions={suggestions} />
          <div className="px-6 pb-1">
            <div className="border-t" />
          </div>
          <div className="px-6 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-semibold">
                <DollarSign className="h-4 w-4" />
                維修項目 / 費用
              </div>
              <div className="flex items-center gap-2">
                {onCreatePart && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={() => onCreatePart(block.device_model_id || null)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    建立零件
                  </Button>
                )}
                {mode === 'admin' && (onRequestPurchase || onNavigateToPurchase) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground text-xs"
                    onClick={() => onRequestPurchase ? onRequestPurchase(block) : onNavigateToPurchase?.()}
                    title="叫料 / 進貨"
                  >
                    <Truck className="h-3.5 w-3.5 mr-1" />
                    叫料/進貨
                  </Button>
                )}
              </div>
            </div>
          </div>
          <ItemsFieldsSection
            block={block}
            onChange={onUpdate}
            mode={mode}
            onCreatePart={onCreatePart}
            onNavigateToPurchase={onNavigateToPurchase}
            onRequestPurchase={onRequestPurchase}
          />
          <FeesFieldsSection block={block} onChange={onUpdate} mode={mode} />
        </>
      )}
      {index === total - 1 && (
        <CardContent className="pt-0">
          <Button variant="outline" className="w-full" onClick={onAddBlock}>
            <Plus className="h-4 w-4 mr-1" />
            新增一個裝置區塊
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            多機型拆單：每一機型各建立一張獨立維修單（共用上方客戶與指派設定）。
          </p>
        </CardContent>
      )}
    </Card>
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