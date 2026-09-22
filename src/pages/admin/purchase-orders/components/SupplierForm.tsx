import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Truck } from 'lucide-react';
import { Supplier } from '../types';

interface SupplierFormProps {
  onSubmit: (data: Partial<Supplier>) => void;
  isLoading: boolean;
  initial?: Partial<Supplier> | null;
}

export function SupplierForm({
  onSubmit,
  isLoading,
  initial,
}: SupplierFormProps) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [contactName, setContactName] = useState(initial?.contact_name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [isLogistics, setIsLogistics] = useState(!!initial?.is_logistics_company);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>供應商名稱 *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>聯絡人</Label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>電話</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>地址</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>備註</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox
          id="supplier-is-logistics"
          checked={isLogistics}
          onCheckedChange={(checked) => setIsLogistics(checked === true)}
          className="mt-0.5"
        />
        <div className="space-y-1">
          <Label htmlFor="supplier-is-logistics" className="flex cursor-pointer items-center gap-1.5 font-normal">
            <Truck className="h-4 w-4" aria-hidden="true" />
            物流公司
          </Label>
          <p className="text-xs text-muted-foreground">
            勾選後此供應商可作為配送方式（物流）綁定的物流公司，並納入運費月結。可同時作為一般採購供應商。
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            name,
            contact_name: contactName || null,
            phone: phone || null,
            email: email || null,
            address: address || null,
            notes: notes || null,
            is_logistics_company: isLogistics,
          })}
          disabled={!name || isLoading}
        >
          {isLoading ? '處理中...' : isEdit ? '儲存' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
