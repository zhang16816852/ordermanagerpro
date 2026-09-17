import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/formatters';
import { EntryFormController } from './useEntryFormController';

export function EntryShippingFields({ ctl }: { ctl: EntryFormController }) {
  const {
    shippingSuppliers,
    shippingSupplierId,
    setShippingSupplierId,
    setSelectedShipItemIds,
    accounts,
    accountId,
    setAccountId,
    shippingPeriodStart,
    setShippingPeriodStart,
    shippingPeriodEnd,
    setShippingPeriodEnd,
    shipSettleItems,
    selectedShipItemIds,
    toggleShipItem,
    toggleAllShipItems,
    selectedShipTotal,
    payoutCategories,
    categoryId,
    setCategoryId,
  } = ctl;

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/20">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>物流公司（採購商）</Label>
          <Select value={shippingSupplierId} onValueChange={v => { setShippingSupplierId(v); setSelectedShipItemIds([]); }}>
            <SelectTrigger><SelectValue placeholder="選擇物流公司" /></SelectTrigger>
            <SelectContent>
              {shippingSuppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {shippingSuppliers.length === 0 && (
            <p className="text-xs text-muted-foreground">尚無物流公司（請至「採購管理→供應商」建立，並在商品管理將運費型商品綁定所屬公司）</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>付款帳戶</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="選擇帳戶" /></SelectTrigger>
            <SelectContent>
              {accounts.map(acc => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>結算期間起</Label>
          <Input type="date" value={shippingPeriodStart} onChange={e => setShippingPeriodStart(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>結算期間訖</Label>
          <Input type="date" value={shippingPeriodEnd} onChange={e => setShippingPeriodEnd(e.target.value)} />
        </div>
      </div>

      {shippingSupplierId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>選擇月結運費品項（金額由系統計算）</Label>
            {shipSettleItems.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAllShipItems}>
                全選 / 取消全選
              </Button>
            )}
          </div>
          <div className="border rounded-md max-h-[240px] overflow-y-auto bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>訂單</TableHead>
                  <TableHead>運費品項</TableHead>
                  <TableHead>數量</TableHead>
                  <TableHead className="text-right">單價</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipSettleItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
                      無可結算的月結運費品項
                    </TableCell>
                  </TableRow>
                ) : (
                  shipSettleItems.map(item => (
                    <TableRow
                      key={item.id}
                      className={`cursor-pointer ${selectedShipItemIds.includes(item.id) ? 'bg-muted' : 'hover:bg-muted/50'}`}
                      onClick={() => toggleShipItem(item.id)}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedShipItemIds.includes(item.id)}
                          onCheckedChange={() => toggleShipItem(item.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.orderCode}</TableCell>
                      <TableCell className="text-sm">{item.productName}</TableCell>
                      <TableCell className="text-sm">×{item.qty}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatCurrency(item.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {selectedShipItemIds.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-md border bg-background">
          <span className="text-sm text-muted-foreground">
            已選 {selectedShipItemIds.length} 項運費，結算金額（系統計算）：
          </span>
          <span className="font-bold">{formatCurrency(selectedShipTotal)}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label>分類（選填）</Label>
        <Select value={categoryId || ''} onValueChange={setCategoryId}>
          <SelectTrigger><SelectValue placeholder="選擇分類" /></SelectTrigger>
          <SelectContent>
            {payoutCategories.map(cat => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}