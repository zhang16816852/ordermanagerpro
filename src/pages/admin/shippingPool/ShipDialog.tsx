import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { formatCurrency } from '@/lib/formatters';
import { GroupedByStore, getDisplayName } from "./shippingPoolTypes";

interface ShipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: { storeCount: number; itemCount: number; totalQuantity: number };
  groups: GroupedByStore[];
  selectedStores: Set<string>;
  ownWarehouses: Array<{ id: string; name: string }>;
  poolStock: Record<string, Record<string, number>> | undefined;
  consignmentOverrideMap: Record<string, boolean>;
  onConsignmentOverrideChange: (orderItemId: string, value: boolean) => void;
  getSourceValue: (orderItemId: string) => string;
  onSourceValueChange: (orderItemId: string, value: string) => void;
  shippedAt: string;
  onShippedAtChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function ShipDialog({
  open,
  onOpenChange,
  summary,
  groups,
  selectedStores,
  ownWarehouses,
  poolStock,
  consignmentOverrideMap,
  onConsignmentOverrideChange,
  getSourceValue,
  onSourceValueChange,
  shippedAt,
  onShippedAtChange,
  notes,
  onNotesChange,
  isPending,
  onConfirm,
}: ShipDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            確認出貨
          </DialogTitle>
          <DialogDescription>
            將選定店家的待出貨品項出貨。一般品項合併產生銷售單；寄賣品項以店家寄賣方式出貨，確認售出後才開立銷貨單。出貨後資料將從集貨池中移除。
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 space-y-4">
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">店家數量：</span>
                <span className="font-medium">{summary.storeCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">商品項目：</span>
                <span className="font-medium">{summary.itemCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">總數量：</span>
                <span className="font-medium">{summary.totalQuantity}</span>
              </div>
            </div>
          </div>
          {groups.filter(g => selectedStores.has(g.storeId)).map(group => {
            const groupTotal = group.items.reduce((sum, item) => sum + item.quantity * (item.order_item?.unit_price || 0), 0);
            return (
              <div key={group.storeId} className="space-y-2 border rounded p-3">
                <div className="flex items-center justify-between border-b pb-1">
                  <h3 className="font-bold text-primary">{group.storeName}</h3>
                  <Badge variant="outline">{group.items.length} 項 / {group.totalQuantity} 件</Badge>
                </div>
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>商品</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                      <TableHead className="text-right">小計</TableHead>
                      <TableHead className="w-16 text-center">寄賣</TableHead>
                      <TableHead>出貨來源</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map(item => {
                      const isConsignment = !!item.order_item?.order?.consignment_mode;
                      const isOverride = !isConsignment && !!consignmentOverrideMap[item.order_item_id];
                      const showConsignment = isConsignment || isOverride;
                      const stockKey = `${item.order_item?.product_id}:${item.order_item?.variant_id || ""}`;
                      const stockByWh = poolStock?.[stockKey] || {};
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm">
                            {getDisplayName(item)}
                            {isConsignment && <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0 font-normal">寄賣</Badge>}
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.order_item?.unit_price)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(item.quantity * (item.order_item?.unit_price || 0))}</TableCell>
                          <TableCell className="text-center">
                            {isConsignment ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">寄賣</Badge>
                            ) : (
                              <Switch
                                checked={isOverride}
                                onCheckedChange={(v) => onConsignmentOverrideChange(item.order_item_id, v)}
                                title="此項目改以店家寄賣方式出貨"
                                aria-label="轉為店家寄賣出貨"
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            {showConsignment ? (
                              <span className="text-xs text-muted-foreground">店家寄賣</span>
                            ) : (
                              <Select
                                value={getSourceValue(item.order_item_id)}
                                onValueChange={(v) => onSourceValueChange(item.order_item_id, v)}
                              >
                                <SelectTrigger className="h-8 w-56 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ownWarehouses.map(w => (
                                    <SelectItem key={w.id} value={`wh:${w.id}`}>
                                      自有 · {w.name}（庫存:{stockByWh[w.id] ?? 0}）
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="sc">供應商寄賣（FIFO）</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="text-right text-sm font-bold">
                  合計：{formatCurrency(groupTotal)}
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">出貨時間</label>
              <Input
                type="datetime-local"
                value={shippedAt}
                onChange={(e) => onShippedAtChange(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">備註（選填）</label>
              <Textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="輸入出貨備註..."
                className="mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="p-6 pt-2 bg-muted/20 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "處理中..." : "確認出貨"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}