import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ChevronDown, Warehouse } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { WarehouseSelector } from '@/components/WarehouseSelector';
import { StorePicker } from '@/components/ui/StorePicker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { OrderItemRow } from '@/components/order/OrderItemsTable';

export type OrderTypeValue = 'sales' | 'purchase' | 'consignment_receive' | 'consignment_send';

interface OrderInfoCardProps {
  orderType: OrderTypeValue;
  isEditMode: boolean;
  order?: any;
  displayStoreName?: string;
  displayBrand?: string | null;
  storesList: { id: string; name: string; code: string | null; brand: string | null }[];
  suppliersList: { id: string; name: string }[];
  storeLocked?: boolean;
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
  supplierId: string;
  onSupplierChange: (id: string) => void;
  targetStoreId: string;
  onTargetStoreChange: (id: string) => void;
  expectedDate: string;
  onExpectedDateChange: (v: string) => void;
  supplierOrderNumber: string;
  onSupplierOrderNumberChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  shippedAt: string;
  onShippedAtChange: (v: string) => void;
  consignmentMode: boolean;
  onConsignmentModeChange: (v: boolean) => void;
  items: OrderItemRow[];
  getItemWarehouse: (id: string) => string;
  itemWarehouses: Record<string, string>;
  onItemWarehouseChange: (id: string, w: string) => void;
  itemSources: Record<string, string>;
  onItemSourceChange: (id: string, src: string) => void;
}

export function OrderInfoCard({
  orderType,
  isEditMode,
  order,
  displayStoreName,
  displayBrand,
  storesList,
  suppliersList,
  storeLocked = false,
  selectedStoreId,
  onStoreChange,
  supplierId,
  onSupplierChange,
  targetStoreId,
  onTargetStoreChange,
  expectedDate,
  onExpectedDateChange,
  supplierOrderNumber,
  onSupplierOrderNumberChange,
  notes,
  onNotesChange,
  shippedAt,
  onShippedAtChange,
  consignmentMode,
  onConsignmentModeChange,
  items,
  getItemWarehouse,
  itemWarehouses,
  onItemWarehouseChange,
  itemSources,
  onItemSourceChange,
}: OrderInfoCardProps) {
  const [warehouseExpanded, setWarehouseExpanded] = useState(false);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{isEditMode ? '訂單資訊' : (
          orderType === 'purchase' ? '採購資訊' :
          orderType === 'consignment_receive' ? '寄賣收貨資訊' :
          orderType === 'consignment_send' ? '寄賣出貨資訊' : '訂單資訊'
        )}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isEditMode ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">店鋪：</span>
                <span className="font-medium">{displayStoreName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">品牌：</span>
                <span className="font-medium">{displayBrand || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">建立時間：</span>
                <span>{format(new Date(order!.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">來源：</span>
                <span>{order!.source_type === 'frontend' ? '前台' : order!.source_type === 'consignment' ? '寄賣' : '後台'}</span>
              </div>
            </div>
          ) : (
            <>
              {orderType === 'sales' && (
                storeLocked ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">店鋪：</span>
                      <span className="font-medium">{displayStoreName}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">品牌：</span>
                      <span className="font-medium">{displayBrand || '-'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>門市</Label>
                    <StorePicker
                      stores={storesList}
                      value={selectedStoreId}
                      onChange={(v) => onStoreChange(Array.isArray(v) ? v[0] || '' : v)}
                      valueField="id"
                      placeholder="搜尋門市名稱或編號..."
                    />
                  </div>
                )
              )}

              {orderType === 'purchase' && (
                <>
                  <div className="space-y-2">
                    <Label>供應商</Label>
                    <Select value={supplierId} onValueChange={onSupplierChange}>
                      <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                      <SelectContent>
                        {suppliersList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>預計到貨日（選填）</Label>
                      <Input type="date" value={expectedDate} onChange={(e) => onExpectedDateChange(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>廠商單號（選填）</Label>
                      <Input value={supplierOrderNumber} onChange={(e) => onSupplierOrderNumberChange(e.target.value)} placeholder="廠商端訂單編號" />
                    </div>
                  </div>
                </>
              )}

              {orderType === 'consignment_receive' && (
                <div className="space-y-2">
                  <Label>供應商</Label>
                  <Select value={supplierId} onValueChange={onSupplierChange}>
                    <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                    <SelectContent>
                      {suppliersList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {orderType === 'consignment_send' && (
                <>
                  <div className="space-y-2">
                    <Label>供應商</Label>
                    <Select value={supplierId} onValueChange={onSupplierChange}>
                      <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                      <SelectContent>
                        {suppliersList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>目標門市</Label>
                    <StorePicker
                      stores={storesList}
                      value={targetStoreId}
                      onChange={(v) => onTargetStoreChange(Array.isArray(v) ? v[0] || '' : v)}
                      valueField="id"
                      placeholder="搜尋門市名稱或編號..."
                    />
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>備註</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Textarea placeholder="輸入備註..." value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={4} />
          {!isEditMode && orderType === 'sales' && (
            <>
              <div>
                <label className="text-sm font-medium">出貨時間</label>
                <Input
                  type="datetime-local"
                  value={shippedAt}
                  onChange={(e) => onShippedAtChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">寄賣模式</div>
                  <div className="text-xs text-muted-foreground">
                    訂單出貨時以店家寄賣方式轉出，不扣自有庫存
                  </div>
                </div>
                <Switch checked={consignmentMode} onCheckedChange={onConsignmentModeChange} />
              </div>
            </>
          )}
          {!isEditMode && orderType === 'sales' && items.length > 0 && (
            <Collapsible open={warehouseExpanded} onOpenChange={setWarehouseExpanded}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
                  <Warehouse className="h-4 w-4" />
                  <span>出貨倉設定</span>
                  <ChevronDown className={`h-4 w-4 ml-auto transition-transform duration-200 ${warehouseExpanded ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                {!consignmentMode ? (
                  items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate">{item.productName || item.sku || item.id.slice(0, 8)}</span>
                      <WarehouseSelector
                        value={getItemWarehouse(item.id)}
                        onChange={(w) => onItemWarehouseChange(item.id, w)}
                        productId={item.productId}
                        variantId={item.variantId}
                      />
                      <Select
                        value={itemSources[item.id] || "self"}
                        onValueChange={(v) => onItemSourceChange(item.id, v)}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="self">自有庫存</SelectItem>
                          <SelectItem value="supplier_consignment">供應商寄賣</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    寄賣模式：出貨時以店家寄賣方式轉出（庫存來源為「店家寄賣」，不扣自有庫存）。
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
