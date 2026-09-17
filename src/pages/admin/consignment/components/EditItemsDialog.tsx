import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentOrder, ConsignmentOrderItem, NewConsignmentItem } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface EditItemsDialogProps {
  order: ConsignmentOrder;
  items: ConsignmentOrderItem[];
  onCancel: () => void;
}

interface EditLine {
  quantity: number;
  unit_price: number;
  unit_cost: number;
}

interface EditNewLine extends NewConsignmentItem {
  key: string;
}

export function EditItemsDialog({ order, items, onCancel }: EditItemsDialogProps) {
  const { products, addItemMutation, removeItemMutation, updateItemMutation } = useConsignment();
  const isSupplier = order.direction === 'receive_from_supplier';
  const [saving, setSaving] = useState(false);

  const [edits, setEdits] = useState<Record<string, EditLine>>(() => {
    const init: Record<string, EditLine> = {};
    items.forEach(item => {
      init[item.id] = {
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
      };
    });
    return init;
  });

  const [newLines, setNewLines] = useState<EditNewLine[]>([]);

  const addLine = () => {
    setNewLines(prev => [...prev, { key: crypto.randomUUID(), product_id: '', variant_id: null, quantity: 1, unit_price: 0, unit_cost: 0 }]);
  };
  const removeLine = (key: string) => {
    setNewLines(prev => prev.filter(l => l.key !== key));
  };
  const updateLine = (key: string, patch: Partial<EditNewLine>) => {
    setNewLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  };
  const getVariants = (productId: string) => {
    return products.find((p) => p.id === productId)?.variants || [];
  };

  const handleSave = async () => {
    if (newLines.some(l => !l.product_id)) {
      toast.warning('新增品項需選擇商品');
      return;
    }
    const validNew = newLines.filter(l => l.product_id && l.quantity > 0);
    setSaving(true);
    try {
      for (const item of items) {
        const e = edits[item.id];
        if (!e) continue;
        const patch: Partial<{ quantity: number; unit_price: number; unit_cost: number }> = {};
        if (e.quantity !== item.quantity) patch.quantity = e.quantity;
        if (e.unit_price !== item.unit_price) patch.unit_price = e.unit_price;
        if (e.unit_cost !== item.unit_cost) patch.unit_cost = e.unit_cost;
        if (Object.keys(patch).length > 0) {
          await updateItemMutation.mutateAsync({ orderId: order.id, itemId: item.id, patch });
        }
      }
      for (const line of validNew) {
        await addItemMutation.mutateAsync({
          orderId: order.id,
          item: {
            product_id: line.product_id,
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_price: line.unit_price,
            unit_cost: line.unit_cost,
          },
        });
      }
      toast.success('品項已更新');
      onCancel();
    } catch {
      // 錯誤訊息已由 useSupabaseAction 統一顯示
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>編輯品項（{order.code}）</DialogTitle>
          <DialogDescription>
            修改既有品項的數量與價格，或新增/刪除品項。店家寄賣草稿將同步鏡像到來源訂單。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">商品</th>
                  <th className="text-right py-2 px-3 font-medium w-20">數量</th>
                  <th className="text-right py-2 px-3 font-medium w-28">
                    {isSupplier ? '成本價' : '出貨價'}
                  </th>
                  <th className="text-right py-2 px-3 font-medium w-28">
                    {isSupplier ? '建議售價' : '進貨成本'}
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const e = edits[item.id] || { quantity: item.quantity, unit_price: item.unit_price, unit_cost: item.unit_cost };
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-1.5 px-3">
                        <p className="font-medium">{item.variant?.name || item.product?.name || '-'}</p>
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={1}
                          className="h-8 text-right text-xs"
                          value={e.quantity}
                          onChange={(ev) => setEdits(prev => ({
                            ...prev,
                            [item.id]: { ...e, quantity: Math.max(1, parseInt(ev.target.value) || 1) },
                          }))}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 text-right text-xs"
                          value={e.unit_price}
                          onChange={(ev) => setEdits(prev => ({
                            ...prev,
                            [item.id]: { ...e, unit_price: parseFloat(ev.target.value) || 0 },
                          }))}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 text-right text-xs"
                          value={e.unit_cost}
                          onChange={(ev) => setEdits(prev => ({
                            ...prev,
                            [item.id]: { ...e, unit_cost: parseFloat(ev.target.value) || 0 },
                          }))}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={removeItemMutation.isPending}
                          onClick={() => removeItemMutation.mutate(item.id)}
                          aria-label="刪除品項"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-muted-foreground italic">目前沒有品項</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>新增品項</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> 加入品項
              </Button>
            </div>
            {newLines.length > 0 && (
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 font-medium w-56">商品</th>
                      <th className="text-left py-2 px-3 font-medium w-28">規格</th>
                      <th className="text-right py-2 px-3 font-medium w-20">數量</th>
                      <th className="text-right py-2 px-3 font-medium w-28">
                        {isSupplier ? '成本價' : '出貨價'}
                      </th>
                      <th className="text-right py-2 px-3 font-medium w-28">
                        {isSupplier ? '建議售價' : '進貨成本'}
                      </th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newLines.map(line => (
                      <tr key={line.key} className="border-b last:border-0">
                        <td className="py-1.5 px-2">
                          <Select value={line.product_id} onValueChange={(v) => updateLine(line.key, { product_id: v, variant_id: null })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="選擇商品" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1.5 px-2">
                          {(() => {
                            const variants = getVariants(line.product_id);
                            if (!line.product_id) {
                              return <div className="px-1 text-xs text-muted-foreground">先選擇商品</div>;
                            }
                            if (variants.length === 0) {
                              return <div className="px-1 text-xs text-muted-foreground">無規格</div>;
                            }
                            return (
                              <Select
                                value={line.variant_id || ''}
                                onValueChange={(v) => updateLine(line.key, { variant_id: v })}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="選擇規格" />
                                </SelectTrigger>
                                <SelectContent>
                                  {variants.map((v) => (
                                    <SelectItem key={v.id} value={v.id}>{v.name || v.sku}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })()}
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            type="number"
                            min={1}
                            className="h-8 text-right text-xs"
                            value={line.quantity}
                            onChange={(ev) => updateLine(line.key, { quantity: parseInt(ev.target.value) || 0 })}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-8 text-right text-xs"
                            value={line.unit_cost}
                            onChange={(ev) => updateLine(line.key, { unit_cost: parseFloat(ev.target.value) || 0 })}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-8 text-right text-xs"
                            value={line.unit_price}
                            onChange={(ev) => updateLine(line.key, { unit_price: parseFloat(ev.target.value) || 0 })}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLine(line.key)} aria-label="刪除項目">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存變更'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}