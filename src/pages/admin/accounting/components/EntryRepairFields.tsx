import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Wrench, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { EntryFormController } from './useEntryFormController';

export function EntryRepairFields({ ctl }: { ctl: EntryFormController }) {
  const {
    repairMode,
    handleRepairModeChange,
    repairOrders,
    selectedRepairOrderId,
    setSelectedRepairOrderId,
    setAmount,
    setDescription,
    purchaseOrders,
    selectedPurchaseOrderId,
    setSelectedPurchaseOrderId,
    serviceVendorName,
    setServiceVendorName,
    description,
    accounts,
    accountId,
    setAccountId,
    amount,
    categories,
    categoryId,
    setCategoryId,
  } = ctl;

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/20">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => handleRepairModeChange('income_repair')}
          className={`p-3 rounded-lg border text-left transition-all ${
            repairMode === 'income_repair'
              ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30 font-medium'
              : 'border-border/60 bg-card hover:bg-accent/40'
          }`}
        >
          <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
            <ArrowDownLeft className="h-4 w-4" />
            收維修款（收入）
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            向客戶收取維修費或訂金款項
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleRepairModeChange('expense_part')}
          className={`p-3 rounded-lg border text-left transition-all ${
            repairMode === 'expense_part'
              ? 'border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/30 font-medium'
              : 'border-border/60 bg-card hover:bg-accent/40'
          }`}
        >
          <div className="flex items-center gap-1.5 text-sm text-rose-600 dark:text-rose-400 font-semibold">
            <ArrowUpRight className="h-4 w-4" />
            付零件款（支出）
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            支付零件供應商貨款（進貨扣款）
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleRepairModeChange('expense_service')}
          className={`p-3 rounded-lg border text-left transition-all ${
            repairMode === 'expense_service'
              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30 font-medium'
              : 'border-border/60 bg-card hover:bg-accent/40'
          }`}
        >
          <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 font-semibold">
            <Wrench className="h-4 w-4" />
            給廠商服務費
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            外包加工、檢測或技術工資（不走庫存）
          </p>
        </button>
      </div>

      {repairMode === 'income_repair' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>關聯維修單（選填）</Label>
            <span className="text-xs text-muted-foreground">選擇後自動填入金額與客戶資訊</span>
          </div>
          <Select
            value={selectedRepairOrderId}
            onValueChange={(val) => {
              setSelectedRepairOrderId(val);
              const ro = repairOrders.find(r => r.id === val);
              if (ro) {
                if (ro.amount > 0) setAmount(ro.amount.toString());
                setDescription(`維修收款 - ${ro.name}`);
              }
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="選擇要收款的維修單..." />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {repairOrders.map(ro => (
                <SelectItem key={ro.id} value={ro.id}>
                  <div className="flex items-center justify-between gap-4 w-full">
                    <span>{ro.name}</span>
                    {ro.amount > 0 && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatCurrency(ro.amount)}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {repairMode === 'expense_part' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>關聯進貨/採購單（選填）</Label>
            <span className="text-xs text-muted-foreground">選擇後自動填入進貨金額與廠商</span>
          </div>
          <Select
            value={selectedPurchaseOrderId}
            onValueChange={(val) => {
              setSelectedPurchaseOrderId(val);
              const po = purchaseOrders.find(p => p.id === val);
              if (po) {
                if (po.amount > 0) setAmount(po.amount.toString());
                setDescription(`維修零件採購款 - ${po.name}（單號 ${po.code}）`);
              }
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="選擇零件進貨採購單..." />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {purchaseOrders.map(po => (
                <SelectItem key={po.id} value={po.id}>
                  <div className="flex items-center justify-between gap-4 w-full">
                    <span>{po.code} - {po.name}</span>
                    {po.amount > 0 && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatCurrency(po.amount)}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {repairMode === 'expense_service' && (
        <div className="space-y-3">
          <div className="p-2.5 rounded border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Wrench className="h-4 w-4 shrink-0" />
            <span>此項費用為純服務/技術工資支出，<strong>不需要走庫存</strong>，專用於記錄外送維修、第三方晶片加工或檢測費用。</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>外包廠商 / 服務提供商名稱</Label>
              <Input
                value={serviceVendorName}
                onChange={(e) => setServiceVendorName(e.target.value)}
                placeholder="例如：晶片快修廠、外部技師"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label>對應維修單（選填）</Label>
              <Select
                value={selectedRepairOrderId}
                onValueChange={(val) => {
                  setSelectedRepairOrderId(val);
                  const ro = repairOrders.find(r => r.id === val);
                  if (ro && !description) {
                    setDescription(`外包服務費 - ${ro.name}${serviceVendorName ? ` (${serviceVendorName})` : ''}`);
                  }
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="可選擇對應維修單..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {repairOrders.map(ro => (
                    <SelectItem key={ro.id} value={ro.id}>
                      {ro.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>
            {repairMode === 'income_repair' ? '收款帳戶' : '付款帳戶'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="選擇帳戶" /></SelectTrigger>
            <SelectContent>
              {accounts.map(acc => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            金額 <span className="text-destructive">*</span>
          </Label>
          <Input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="輸入金額"
            className="h-9 font-medium"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>會計分類</Label>
          <Badge variant="outline" className="text-[10px]">
            {repairMode === 'income_repair' ? '收入類別' : '支出類別'}
          </Badge>
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-9"><SelectValue placeholder="選擇分類..." /></SelectTrigger>
          <SelectContent>
            {(repairMode === 'income_repair'
              ? categories.filter(c => c.type === 'income')
              : categories.filter(c => c.type === 'expense')
            ).map(cat => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}