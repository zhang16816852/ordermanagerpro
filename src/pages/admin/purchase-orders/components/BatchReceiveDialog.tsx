import { useEffect, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  PO_ORDER_SKIP_LABELS,
  PO_RECEIVE_SKIP_LABELS,
  poOrderSkipReason,
} from '../batchActions';
import { loadBatchReceiveItems, loadPoHeaders, toReceivePlanRow } from '../batchReceiveData';
import { useWarehouses } from '@/pages/admin/inventory/hooks/useWarehouses';
import type { PurchaseOrder } from '../types';

interface BatchReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 畫面上選取的採購單（原始順序、無預先過濾） */
  orders: PurchaseOrder[];
  isPending: boolean;
  onConfirm: (orderIds: string[], warehouseId: string) => void;
}

/**
 * 批次收貨預覽 + 送出。
 *
 * ⚠️ 預覽與送出都走 `loadPoHeaders` / `loadBatchReceiveItems` 重新查詢：
 * `receive_purchase_items` 沒有狀態守門、會以絕對值覆寫 received_quantity
 * 並寫等量庫存異動，用畫面快取當送出依據等於重複入帳或把已取消單復活。
 */
export function BatchReceiveDialog({
  open,
  onOpenChange,
  orders,
  isPending,
  onConfirm,
}: BatchReceiveDialogProps) {
  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const [warehouseId, setWarehouseId] = useState('');

  const { defaultWarehouse, warehouses, isLoading: warehousesLoading } = useWarehouses();

  /**
   * 收貨目標倉庫預設必須是自有倉（`code='own'`）。
   *
   * `useWarehouses().defaultWarehouse` 只是 `sort_order = 0` 的那一間，並不保證是
   * 自有倉；既有單張收貨流程（ReceivingTab／ReceiveForm）沿用該欄位，但批次收貨會一次
   * 入帳大量品項，誤入供應商寄賣倉會污染寄賣庫存，故優先鎖定 `code='own'`，
   * 僅在查不到時才回退（此時使用者仍可在下拉中改選）。
   */
  const ownWarehouse = useMemo(() => warehouses.find((w) => w.code === 'own'), [warehouses]);
  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.is_active !== false),
    [warehouses],
  );

  useEffect(() => {
    if (open) setWarehouseId(ownWarehouse?.id || defaultWarehouse?.id || '');
  }, [open, ownWarehouse?.id, defaultWarehouse?.id]);

  // 預覽與 warehouse 無關（receive_purchase_items 才依 warehouse 入帳），
  // 故 query key 只帶 orderIds：切換倉庫時不需要重新查詢，也不會出現過期快取。
  const preview = useQuery({
    queryKey: ['po-batch-receive-preview', orderIds],
    queryFn: async () => {
      const headers = await loadPoHeaders(orderIds);
      const found = new Set(headers.map((h) => h.id));
      // 已被刪除的單據不會出現在 headers，必須明確回報而非靜默消失，
      // 否則使用者會以為那幾張只是「沒有品項」。
      const missing = orderIds.filter((id) => !found.has(id));
      const eligible = headers.filter((h) => poOrderSkipReason(h) === null).map((h) => h.id);
      const rows = eligible.length === 0 ? [] : (await loadBatchReceiveItems(eligible)).map(toReceivePlanRow);
      return { rows, receivable: eligible, excluded: headers, missing };
    },
    enabled: open && orderIds.length > 0,
  });

  const rows = preview.data?.rows ?? [];
  const receivableRows = rows.filter((r) => r.receivable);
  const skippedRows = rows.filter((r) => !r.receivable);

  const excludedOrders = (preview.data?.excluded ?? []).filter((h) => poOrderSkipReason(h) !== null);
  const missingOrders = preview.data?.missing ?? [];

  const canSubmit =
    !!warehouseId &&
    (preview.data?.receivable.length ?? 0) > 0 &&
    receivableRows.length > 0 &&
    !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批次收貨</DialogTitle>
          <DialogDescription>
            一次為多張採購單的未收貨品項建立庫存入帳。以下清單取自伺服器最新狀態。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>入庫倉庫</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇倉庫" />
              </SelectTrigger>
              <SelectContent>
                {activeWarehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.code === 'own' ? '（自有倉）' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!warehousesLoading && activeWarehouses.length === 0 && (
              <p className="text-sm text-destructive">沒有可用的入庫倉庫，請先至庫存管理新增倉庫。</p>
            )}
          </div>

          {preview.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在載入最新收貨狀態…
            </div>
          )}

          {preview.isError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>無法載入最新收貨狀態，請關閉後重試。</span>
            </div>
          )}

          {preview.isSuccess && (
            <>
              <div className="text-sm">
                將收貨 <strong>{receivableRows.length}</strong> 筆品項，
                來自 <strong>{preview.data?.receivable.length ?? 0}</strong> 張採購單
              </div>

              {receivableRows.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">廠商單號</th>
                        <th className="text-right font-medium px-3 py-2">數量</th>
                        <th className="text-right font-medium px-3 py-2">已收</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receivableRows.map((r) => (
                        <tr key={r.itemId} className="border-t">
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {orders.find((o) => o.id === r.purchaseOrderId)?.supplier_order_number
                              || r.purchaseOrderId.slice(0, 8)}
                          </td>
                          <td className="px-3 py-1.5 text-right">{r.quantity}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {r.received_quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(skippedRows.length > 0 || excludedOrders.length > 0 || missingOrders.length > 0) && (
                <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm space-y-2">
                  <div className="flex items-center gap-2 font-medium text-amber-800">
                    <AlertTriangle className="h-4 w-4" /> 將被排除的項目
                  </div>
                  {missingOrders.length > 0 && (
                    <ul className="space-y-1 text-amber-900">
                      {missingOrders.map((id) => (
                        <li key={id}>
                          採購單 {orders.find((o) => o.id === id)?.supplier_order_number || id.slice(0, 8)}：查無此單（可能已被刪除）
                        </li>
                      ))}
                    </ul>
                  )}
                  {excludedOrders.length > 0 && (
                    <ul className="space-y-1 text-amber-900">
                      {excludedOrders.map((h) => (
                        <li key={h.id}>
                          採購單 {h.supplier_order_number || h.id.slice(0, 8)}：{PO_ORDER_SKIP_LABELS[poOrderSkipReason(h)!]}
                        </li>
                      ))}
                    </ul>
                  )}
                  {skippedRows.length > 0 && (
                    <ul className="space-y-1 text-amber-900">
                      {skippedRows.map((r) => (
                        <li key={r.itemId}>
                          品項 {r.itemId.slice(0, 8)}：{PO_RECEIVE_SKIP_LABELS[r.skipReason!]}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(preview.data?.receivable ?? [], warehouseId)}
            disabled={!canSubmit}
          >
            {isPending ? '收貨中…' : '確認收貨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}