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
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Warehouse, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { WarehouseSelector } from '@/components/WarehouseSelector';
import { StorePicker } from '@/components/ui/StorePicker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { OrderItemRow } from '@/components/order/orderItemsTypes';
import type { PanelState } from '@/components/order/OrderItemsPanel';
import {
  PO_MANUAL_STATUSES,
  PO_PURPOSE_LABELS,
  PO_STATUS_LABELS,
  type PurchaseOrderManualStatus,
  type PurchaseOrderPurpose,
  type PurchaseOrderStatus,
} from '@/pages/admin/purchase-orders/types';

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
  /** 採購編輯：單據日期（建立模式不提供，order_date 由 RPC 落 CURRENT_DATE） */
  purchaseOrderDate?: string;
  onPurchaseOrderDateChange?: (v: string) => void;
  /** 採購編輯：狀態（partial_received/received 為收貨衍生，唯讀顯示） */
  purchaseStatus?: PurchaseOrderStatus;
  onPurchaseStatusChange?: (v: PurchaseOrderStatus) => void;
  purchaseStatusLocked?: boolean;
  purchasePurpose?: PurchaseOrderPurpose;
  onPurchasePurposeChange?: (v: PurchaseOrderPurpose) => void;
  /** 採購編輯：供應商不可變更（update RPC 不接受 p_supplier_id） */
  supplierLocked?: boolean;
  notes: string;
  onNotesChange: (v: string) => void;
  shippedAt: string;
  onShippedAtChange: (v: string) => void;
  consignmentMode: boolean;
  onConsignmentModeChange: (v: boolean) => void;
  consignmentModePending?: boolean;
  isRep?: boolean;
  items: OrderItemRow[];
  getItemWarehouse: (id: string) => string;
  itemWarehouses: Record<string, string>;
  onItemWarehouseChange: (id: string, w: string) => void;
  itemSources: Record<string, string>;
  onItemSourceChange: (id: string, src: string) => void;
  activePanel?: PanelState;
  onTogglePanel?: () => void;
  collapsed?: boolean;
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
  purchaseOrderDate = '',
  onPurchaseOrderDateChange,
  purchaseStatus,
  onPurchaseStatusChange,
  purchaseStatusLocked = false,
  purchasePurpose = 'general',
  onPurchasePurposeChange,
  supplierLocked = false,
  notes,
  onNotesChange,
  shippedAt,
  onShippedAtChange,
  consignmentMode,
  onConsignmentModeChange,
  consignmentModePending = false,
  isRep = false,
  items,
  getItemWarehouse,
  itemWarehouses,
  onItemWarehouseChange,
  itemSources,
  onItemSourceChange,
  activePanel,
  onTogglePanel,
  collapsed = false,
}: OrderInfoCardProps) {
  const [warehouseExpanded, setWarehouseExpanded] = useState(false);

  const cardTitle = isEditMode ? '訂單資訊' : (
    orderType === 'purchase' ? '採購資訊' :
    orderType === 'consignment_receive' ? '寄賣收貨資訊' :
    orderType === 'consignment_send' ? '寄賣出貨資訊' : '訂單資訊'
  );

  const summaryLabel = isEditMode
    ? (displayStoreName || order?.stores?.name)
    : orderType === 'sales'
    ? (displayStoreName || '未選門市')
    : orderType === 'consignment_send'
    ? (storesList.find((s) => s.id === targetStoreId)?.name || '未選目標門市')
    : suppliersList.find((s) => s.id === supplierId)?.name || '未選供應商';

  // 編輯模式以伺服器資料為準（切換寄賣模式為立即執行的動作，非可儲存欄位）
  const consignmentSwitchChecked = isEditMode ? !!order?.consignment_mode : consignmentMode;
  const consignmentSwitchDisabled = isRep || (isEditMode
    ? !order || order.status === 'shipped' || order.status === 'cancelled'
    : false);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader
        className="sticky top-0 bg-background z-10 shrink-0 cursor-pointer select-none py-3 px-4"
        onClick={onTogglePanel}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{cardTitle}</CardTitle>
            {summaryLabel && (
              <Badge variant="outline" className="text-xs font-normal max-w-[150px] truncate">
                {summaryLabel}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="flex-1 min-h-0 overflow-auto p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
          {isEditMode ? (
            <div className="grid grid-cols-2 gap-4 text-sm bg-muted/40 p-3 rounded-lg">
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
                <span>{order?.created_at ? format(new Date(order.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW }) : '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">來源：</span>
                <span>{order?.source_type === 'frontend' ? '前台' : order?.source_type === 'consignment' ? '寄賣' : '後台'}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {orderType === 'sales' && (
                storeLocked ? (
                  <div className="grid grid-cols-2 gap-4 text-sm bg-muted/40 p-3 rounded-lg">
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
                    <Select value={supplierId} onValueChange={onSupplierChange} disabled={supplierLocked}>
                      <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                      <SelectContent>
                        {suppliersList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {supplierLocked && (
                      <p className="text-xs text-muted-foreground">採購單建立後不可變更供應商。</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {isEditMode && onPurchaseOrderDateChange && (
                      <div className="space-y-2">
                        <Label>單據日期</Label>
                        <Input
                          type="date"
                          value={purchaseOrderDate}
                          onChange={(e) => onPurchaseOrderDateChange(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>預計到貨日（選填）</Label>
                      <Input type="date" value={expectedDate} onChange={(e) => onExpectedDateChange(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>廠商單號（選填）</Label>
                      <Input value={supplierOrderNumber} onChange={(e) => onSupplierOrderNumberChange(e.target.value)} placeholder="廠商端訂單編號" />
                    </div>
                  </div>
                  {isEditMode && onPurchaseStatusChange && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="po-status">狀態</Label>
                        <Select
                          value={purchaseStatus}
                          onValueChange={onPurchaseStatusChange}
                          disabled={purchaseStatusLocked}
                        >
                          <SelectTrigger id="po-status"><SelectValue placeholder="選擇狀態" /></SelectTrigger>
                          <SelectContent>
                            {(PO_MANUAL_STATUSES as readonly string[]).map((s) => (
                              <SelectItem key={s} value={s}>{PO_STATUS_LABELS[s as PurchaseOrderManualStatus]}</SelectItem>
                            ))}
                            {purchaseStatus &&
                              !PO_MANUAL_STATUSES.includes(purchaseStatus as PurchaseOrderManualStatus) && (
                                <SelectItem value={purchaseStatus} disabled>
                                  {PO_STATUS_LABELS[purchaseStatus as PurchaseOrderStatus] || purchaseStatus}（由收貨決定）
                                </SelectItem>
                              )}
                          </SelectContent>
                        </Select>
                        {purchaseStatusLocked && (
                          <p className="text-xs text-muted-foreground">已有收貨品項，狀態由收貨結果自動計算。</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="po-purpose">單據類型</Label>
                        <Select value={purchasePurpose} onValueChange={onPurchasePurposeChange}>
                          <SelectTrigger id="po-purpose"><SelectValue placeholder="選擇類型" /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PO_PURPOSE_LABELS) as PurchaseOrderPurpose[]).map((p) => (
                              <SelectItem key={p} value={p}>{PO_PURPOSE_LABELS[p]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
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
                <div className="space-y-2">
                  <Label>目標門市</Label>
                  <StorePicker
                    stores={storesList}
                    value={targetStoreId}
                    onChange={(v) => onTargetStoreChange(Array.isArray(v) ? v[0] || '' : v)}
                    valueField="id"
                    placeholder="搜尋門市名稱或編號..."
                  />
                  <p className="text-xs text-muted-foreground">
                    寄賣出貨的合作對象只有門市（結算對象為店家），不需選擇供應商。
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>備註</Label>
            <Textarea placeholder="輸入備註..." value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={3} />
          </div>

          {(isEditMode || orderType === 'sales') && (
            <div className="space-y-4 pt-2 border-t">
              <div>
                <Label className="text-sm font-medium">出貨時間</Label>
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
                    {isEditMode
                      ? '切換後立即生效：未確認單會建立寄賣草稿並鏡像品項，處理中單則於出貨時轉為寄賣單'
                      : '訂單出貨時以店家寄賣方式轉出，不扣自有庫存'}
                  </div>
                </div>
                <Switch
                  checked={consignmentSwitchChecked}
                  disabled={consignmentSwitchDisabled || consignmentModePending}
                  onCheckedChange={onConsignmentModeChange}
                />
              </div>
              {isEditMode && consignmentSwitchDisabled && order && !isRep && (
                <p className="text-xs text-muted-foreground">已出貨或已取消的訂單無法切換寄賣模式。</p>
              )}
            </div>
          )}

          {!isEditMode && orderType === 'sales' && items.length > 0 && (
            <Collapsible open={warehouseExpanded} onOpenChange={setWarehouseExpanded} className="pt-2 border-t">
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
                      <span className="w-36 truncate">{item.productName || item.sku || item.id.slice(0, 8)}</span>
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
                        <SelectTrigger className="h-8 w-36 text-xs">
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
      )}
    </Card>
  );
}

