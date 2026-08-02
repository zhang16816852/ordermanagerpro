import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentDirection, NewConsignmentItem } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LineItem extends NewConsignmentItem {
  key: string;
}

export function CreateOrderDialog({ open, onOpenChange }: CreateOrderDialogProps) {
  const { suppliers, stores, products, createOrderMutation, addItemMutation } = useConsignment();
  const [direction, setDirection] = useState<ConsignmentDirection>('receive_from_supplier');
  const [partnerId, setPartnerId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ key: crypto.randomUUID(), product_id: '', variant_id: null, quantity: 1, unit_price: 0, unit_cost: 0 }]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setDirection('receive_from_supplier');
    setPartnerId('');
    setNote('');
    setLines([{ key: crypto.randomUUID(), product_id: '', variant_id: null, quantity: 1, unit_price: 0, unit_cost: 0 }]);
  };

  const partnerOptions = direction === 'receive_from_supplier' ? suppliers : stores;

  const getVariants = (productId: string) => {
    return products.find((p) => p.id === productId)?.variants || [];
  };

  const updateLine = (key: string, patch: Partial<LineItem>) => {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  };

  const addLine = () => {
    setLines(prev => [...prev, { key: crypto.randomUUID(), product_id: '', variant_id: null, quantity: 1, unit_price: 0, unit_cost: 0 }]);
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(l => l.key !== key));
  };

  const handleSubmit = async () => {
    if (!partnerId) {
      toast.warning(direction === 'receive_from_supplier' ? '請選擇供應商' : '請選擇店家');
      return;
    }
    const validLines = lines.filter(l => l.product_id && l.quantity > 0);
    if (validLines.length === 0) {
      toast.warning('請至少加入一個商品品項');
      return;
    }
    setSubmitting(true);
    try {
      const order = await createOrderMutation.mutateAsync({ direction, partnerId, note });
      for (const item of validLines) {
        await addItemMutation.mutateAsync({ orderId: order.id, item });
      }
      toast.success('寄賣單建立完成');
      reset();
      onOpenChange(false);
    } catch (e) {
      // 錯誤訊息已由 useSupabaseAction 統一顯示
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>建立寄賣單</DialogTitle>
          <DialogDescription>
            選擇寄賣方向與合作對象，再新增品項。建立後可於詳情進行收貨或出貨。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>寄賣方向</Label>
              <Select
                value={direction}
                onValueChange={(v: ConsignmentDirection) => {
                  setDirection(v);
                  setPartnerId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receive_from_supplier">廠商寄賣（向廠商收貨）</SelectItem>
                  <SelectItem value="send_to_store">店家寄賣（出貨給店家）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{direction === 'receive_from_supplier' ? '供應商' : '店家'}</Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇合作對象" />
                </SelectTrigger>
                <SelectContent>
                  {partnerOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>品項</Label>
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium w-56">商品</th>
                    <th className="text-left py-2 px-3 font-medium w-28">規格</th>
                    <th className="text-right py-2 px-3 font-medium w-20">數量</th>
                    <th className="text-right py-2 px-3 font-medium w-28">
                      {direction === 'receive_from_supplier' ? '成本價' : '出貨價'}
                    </th>
                    <th className="text-right py-2 px-3 font-medium w-28">
                      {direction === 'receive_from_supplier' ? '建議售價' : '進貨成本'}
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
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
                          onChange={(e) => updateLine(line.key, { quantity: parseInt(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 text-right text-xs"
                          value={line.unit_cost}
                          onChange={(e) => updateLine(line.key, { unit_cost: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 text-right text-xs"
                          value={line.unit_price}
                          onChange={(e) => updateLine(line.key, { unit_price: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLine(line.key)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-2">
                <Button size="sm" variant="outline" onClick={addLine}>
                  <Plus className="h-4 w-4 mr-1" /> 加入品項
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>備註</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入備註（選填）" />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '建立中...' : '建立寄賣單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
