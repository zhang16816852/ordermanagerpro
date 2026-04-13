import { useState } from 'react';
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
import { DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { PurchaseOrder, Supplier, PurchaseOrderStatus } from '../types';

interface OrderFormProps {
  order: PurchaseOrder | null;
  suppliers: Supplier[];
  onSubmit: (data: Partial<PurchaseOrder>) => void;
  isLoading: boolean;
}

export function OrderForm({
  order,
  suppliers,
  onSubmit,
  isLoading,
}: OrderFormProps) {
  const [supplierId, setSupplierId] = useState(order?.supplier_id || '');
  const [orderDate, setOrderDate] = useState(order?.order_date || format(new Date(), 'yyyy-MM-dd'));
  const [expectedDate, setExpectedDate] = useState(order?.expected_date || '');
  const [notes, setNotes] = useState(order?.notes || '');
  const [status, setStatus] = useState<PurchaseOrderStatus>(order?.status || 'draft');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>供應商</Label>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger>
            <SelectValue placeholder="選擇供應商" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map((supplier) => (
              <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>下單日期</Label>
          <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>預計到貨（選填）</Label>
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
      </div>

      {order && (
        <div className="space-y-2">
          <Label>狀態</Label>
          <Select value={status} onValueChange={(v: PurchaseOrderStatus) => setStatus(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="ordered">已下單</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>備註</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="輸入備註" />
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            supplier_id: supplierId || null,
            order_date: orderDate,
            expected_date: expectedDate || null,
            notes: notes || null,
            status,
          })}
          disabled={isLoading}
        >
          {isLoading ? '處理中...' : order ? '更新' : '建立'}
        </Button>
      </DialogFooter>
    </div>
  );
}
