import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
import { DialogFooter } from '@/components/ui/dialog';
import { X, Plus, HandCoins, Truck, Wrench, DollarSign, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { format } from 'date-fns';
import { AccountingEntry, AccountingCategory, Account, AccountingEntryReference, CURRENCY_OPTIONS, EntryType } from '../types';
import { formatCurrency } from '@/lib/formatters';

export type RepairAccountingSubType = 'income_repair' | 'expense_part' | 'expense_service';

export interface RepairAccountingPrefill {
  subType?: RepairAccountingSubType;
  repairOrderId?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  vendorName?: string;
  amount?: number;
  description?: string;
}

export interface EntryPrefill {
  accountId?: string;
  amount?: number;
  categoryId?: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  transactionDate?: string;
  docItems?: DocItem[];
  markAsPaid?: boolean;
  payout?: { repId?: string; salesNoteId?: string; salesNoteIds?: string[] };
  shipping?: {
    supplierId?: string;
    orderItemIds?: string[];
    periodStart?: string;
    periodEnd?: string;
  };
  repair?: RepairAccountingPrefill;
}

export interface PayoutSubmission {
  repId: string;
  salesNoteId: string;
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
  note?: string;
}

export interface BatchPayoutSubmission {
  repId: string;
  salesNoteIds: string[];
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
}

export interface ShippingSettlementSubmission {
  supplierId: string;
  orderItemIds: string[];
  periodStart: string;
  periodEnd: string;
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
  note?: string;
}

interface EntryFormProps {
  entry: AccountingEntry | null;
  paymentEntry?: AccountingEntry | null;
  prefill?: EntryPrefill | null;
  categories: AccountingCategory[];
  accounts: Account[];
  onSubmit: (data: Partial<AccountingEntry>, references?: AccountingEntryReference[]) => void;
  onRecordPayment?: (data: { entryId: string; amount: number; accountId: string }) => void;
  onPayoutSubmit?: (payload: PayoutSubmission) => void;
  onBatchPayoutSubmit?: (payload: BatchPayoutSubmission) => void;
  onShippingSettleSubmit?: (payload: ShippingSettlementSubmission) => void;
  isLoading: boolean;
}

type DocType = 'sales_note' | 'purchase_order' | 'repair_order';

interface DocItem {
  docType: DocType;
  docId: string;
  code: string;
  name: string;
  date: string;
  originalAmount: number;
  amountApplied: number;
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  sales_note: '銷貨單',
  purchase_order: '採購單',
  repair_order: '維修單',
};

type FormView = 'list' | 'transfer' | 'currency_exchange' | 'payout' | 'shipping' | 'repair';

export function EntryForm({
  entry,
  paymentEntry,
  prefill,
  categories,
  accounts,
  onSubmit,
  onRecordPayment,
  onPayoutSubmit,
  onBatchPayoutSubmit,
  onShippingSettleSubmit,
  isLoading,
}: EntryFormProps) {
  const isPaymentMode = !!paymentEntry;

  const initialPayoutIds = useMemo(() => {
    const p = prefill?.payout;
    if (!p) return [] as string[];
    if (p.salesNoteIds?.length) return p.salesNoteIds;
    if (p.salesNoteId) return [p.salesNoteId];
    return [];
  }, [prefill]);

  const [view, setView] = useState<FormView>(() => {
    if (entry?.type === 'transfer') return 'transfer';
    if (entry?.type === 'currency_exchange') return 'currency_exchange';
    if (prefill?.payout?.repId) return 'payout';
    if (prefill?.shipping) return 'shipping';
    if (prefill?.repair) return 'repair';
    return 'list';
  });
  const [categoryId, setCategoryId] = useState(entry?.category_id || prefill?.categoryId || '');
  const [accountId, setAccountId] = useState(entry?.account_id || prefill?.accountId || '');
  const [transferToAccountId, setTransferToAccountId] = useState(entry?.transfer_to_account_id || '');
  const [exchangeRate, setExchangeRate] = useState(entry?.exchange_rate?.toString() || '');
  const [originalCurrency, setOriginalCurrency] = useState(entry?.original_currency || '');
  const [originalAmount, setOriginalAmount] = useState(entry?.original_amount?.toString() || '');
  const [amount, setAmount] = useState(entry?.amount?.toString() || prefill?.amount?.toString() || '');
  const [description, setDescription] = useState(entry?.description || prefill?.description || '');
  const [transactionDate, setTransactionDate] = useState(entry?.transaction_date || prefill?.transactionDate || format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(entry?.due_date || '');

  const [docItems, setDocItems] = useState<DocItem[]>(prefill?.docItems || []);
  const [docTab, setDocTab] = useState<DocType>('sales_note');

  const [payoutRepId, setPayoutRepId] = useState(prefill?.payout?.repId || '');
  const [selectedPayoutNoteIds, setSelectedPayoutNoteIds] = useState<string[]>(initialPayoutIds);

  // 運費結帳狀態
  const [shippingSupplierId, setShippingSupplierId] = useState(prefill?.shipping?.supplierId || '');
  const [shippingPeriodStart, setShippingPeriodStart] = useState(prefill?.shipping?.periodStart || '');
  const [shippingPeriodEnd, setShippingPeriodEnd] = useState(prefill?.shipping?.periodEnd || '');
  const [selectedShipItemIds, setSelectedShipItemIds] = useState<string[]>(prefill?.shipping?.orderItemIds || []);

  // 維修收支狀態
  const [repairMode, setRepairMode] = useState<RepairAccountingSubType>(prefill?.repair?.subType || 'income_repair');
  const [selectedRepairOrderId, setSelectedRepairOrderId] = useState<string>(prefill?.repair?.repairOrderId || '');
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string>(prefill?.repair?.purchaseOrderId || '');
  const [serviceVendorName, setServiceVendorName] = useState<string>(prefill?.repair?.vendorName || '');

  // Payment mode: amount field for recording payment
  const [paymentAmount, setPaymentAmount] = useState(
    paymentEntry ? (paymentEntry.amount - paymentEntry.paid_amount).toString() : ''
  );

  const sourceCurrency = accounts.find(a => a.id === accountId)?.currency || 'TWD';
  const destCurrency = accounts.find(a => a.id === transferToAccountId)?.currency || 'TWD';

  const isList = view === 'list';
  const isTransferLike = view === 'transfer' || view === 'currency_exchange';
  const isPayout = view === 'payout';
  const isShipping = view === 'shipping';
  const isRepair = view === 'repair';

  const allCategories = useMemo(
    () => categories.filter(c => c.type === 'income' || c.type === 'expense'),
    [categories],
  );

  const payoutCategories = useMemo(
    () => categories.filter(c => c.type === 'expense'),
    [categories],
  );

  useEffect(() => {
    if (!entry) return;
    if (entry.type === 'transfer') setView('transfer');
    else if (entry.type === 'currency_exchange') setView('currency_exchange');
    else setView('list');
    setCategoryId(entry.category_id || '');
    setAccountId(entry.account_id || '');
    setTransferToAccountId(entry.transfer_to_account_id || '');
    setExchangeRate(entry.exchange_rate?.toString() || '');
    setOriginalCurrency(entry.original_currency || '');
    setOriginalAmount(entry.original_amount?.toString() || '');
    setAmount(entry.amount?.toString() || '');
    setDescription(entry.description || '');
    setTransactionDate(entry.transaction_date || format(new Date(), 'yyyy-MM-dd'));
    setDueDate(entry.due_date || '');
    if (entry.references && entry.references.length > 0) {
      setDocItems(entry.references.map(ref => ({
        docType: (ref.reference_type || 'sales_note') as DocType,
        docId: ref.reference_id,
        code: ref.item_name?.split(' ')[0] || ref.reference_id.slice(0, 8),
        name: ref.item_name || '',
        date: entry.transaction_date,
        originalAmount: ref.amount_applied,
        amountApplied: ref.amount_applied,
      })));
    }
  }, [entry]);

  useEffect(() => {
    if (!paymentEntry) return;
    setAccountId(paymentEntry.account_id || '');
    setPaymentAmount((paymentEntry.amount - paymentEntry.paid_amount).toString());
  }, [paymentEntry]);

  useEffect(() => {
    if (isTransferLike && sourceCurrency !== destCurrency && !exchangeRate) {
      setOriginalCurrency(sourceCurrency);
    }
  }, [sourceCurrency, destCurrency, isTransferLike]);

  useEffect(() => {
    if (isTransferLike && exchangeRate && originalAmount) {
      const rate = parseFloat(exchangeRate);
      const orig = parseFloat(originalAmount);
      if (!isNaN(rate) && !isNaN(orig)) setAmount((rate * orig).toString());
    }
  }, [exchangeRate, originalAmount, isTransferLike]);

  useEffect(() => {
    if (isList && docItems.length > 0) {
      setAmount(docItems.reduce((s, d) => s + d.amountApplied, 0).toString());
    }
  }, [docItems, isList]);

  useEffect(() => {
    if (!prefill) return;
    if (prefill.repair) {
      setView('repair');
      if (prefill.repair.subType) setRepairMode(prefill.repair.subType);
      if (prefill.repair.repairOrderId) setSelectedRepairOrderId(prefill.repair.repairOrderId);
      if (prefill.repair.purchaseOrderId) setSelectedPurchaseOrderId(prefill.repair.purchaseOrderId);
      if (prefill.repair.vendorName) setServiceVendorName(prefill.repair.vendorName);
      if (prefill.repair.amount) setAmount(prefill.repair.amount.toString());
      if (prefill.repair.description) setDescription(prefill.repair.description);
    } else if (prefill.payout?.repId) {
      setView('payout');
      setPayoutRepId(prefill.payout.repId);
    } else if (prefill.shipping) {
      setView('shipping');
    }
    if (prefill.accountId) setAccountId(prefill.accountId);
    if (prefill.categoryId) setCategoryId(prefill.categoryId);
    if (prefill.amount && !prefill.repair?.amount) setAmount(prefill.amount.toString());
    if (prefill.description && !prefill.repair?.description) setDescription(prefill.description);
    if (prefill.transactionDate) setTransactionDate(prefill.transactionDate);
  }, [prefill]);

  const handleViewChange = (v: FormView) => {
    setView(v);
    setCategoryId('');
    setDocItems([]);
    setAmount('');
    setDescription('');
    setPayoutRepId('');
    setSelectedPayoutNoteIds([]);
    setShippingSupplierId('');
    setShippingPeriodStart('');
    setShippingPeriodEnd('');
    setSelectedShipItemIds([]);
    setSelectedRepairOrderId('');
    setSelectedPurchaseOrderId('');
    setServiceVendorName('');

    if (v === 'repair') {
      const defaultIncomeCat = categories.find(c => c.type === 'income' && (c.name.includes('維修') || c.name.includes('服務')));
      if (defaultIncomeCat) setCategoryId(defaultIncomeCat.id);
    }
  };

  const handleRepairModeChange = (mode: RepairAccountingSubType) => {
    setRepairMode(mode);
    if (mode === 'income_repair') {
      const cat = categories.find(c => c.type === 'income' && (c.name.includes('維修') || c.name.includes('服務')));
      setCategoryId(cat?.id || '');
    } else if (mode === 'expense_part') {
      const cat = categories.find(c => c.type === 'expense' && (c.name.includes('零件') || c.name.includes('進貨') || c.name.includes('材料') || c.name.includes('採購')));
      setCategoryId(cat?.id || '');
    } else if (mode === 'expense_service') {
      const cat = categories.find(c => c.type === 'expense' && (c.name.includes('外包') || c.name.includes('服務') || c.name.includes('工資') || c.name.includes('技術')));
      setCategoryId(cat?.id || '');
    }
  };

  // === Document queries ===
  const { data: salesNotes = [] } = useQuery({
    queryKey: ['doc-sales-notes'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sales_notes')
        .select(`
          id, code, created_at, status,
          store:stores(name),
          sales_note_items(quantity, order_item:order_items(unit_price))
        `)
        .in('status', ['shipped', 'received'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((n: any) => ({
        id: n.id,
        code: n.code || n.id.slice(0, 8),
        name: n.store?.name || '未知店家',
        date: n.created_at,
        amount: (n.sales_note_items || []).reduce(
          (s: number, i: any) => s + (i.quantity * (i.order_item?.unit_price || 0)), 0
        ),
      }));
    },
    enabled: isList && docTab === 'sales_note',
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['doc-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, supplier_order_number, total_amount, order_date, status, supplier:suppliers(name)')
        .neq('status', 'cancelled')
        .order('order_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((po: any) => ({
        id: po.id,
        code: po.supplier_order_number || po.id.slice(0, 8),
        name: po.supplier?.name || '未知供應商',
        date: po.order_date,
        amount: Number(po.total_amount) || 0,
        supplierName: po.supplier?.name || '',
      }));
    },
    enabled: (isList && docTab === 'purchase_order') || isRepair,
  });

  const { data: repairOrders = [] } = useQuery({
    queryKey: ['doc-repair-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('repair_orders')
        .select('id, code, created_at, status, customer_name, total_price, reported_issue, device_model:device_model_id(name)')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((ro: any) => ({
        id: ro.id,
        code: ro.code || ro.id.slice(0, 8),
        name: `${ro.code || '維修單'}${ro.customer_name ? ` - ${ro.customer_name}` : ''}${ro.device_model?.name ? ` (${ro.device_model.name})` : ''}`,
        date: ro.created_at,
        amount: Number(ro.total_price) || 0,
        customerName: ro.customer_name || '',
        deviceModelName: ro.device_model?.name || '',
      }));
    },
    enabled: (isList && docTab === 'repair_order') || isRepair,
  });

  // === 佣金發放：業務清單 ===
  const { data: payoutReps = [] } = useQuery<{ user_id: string; commission_rate: number; full_name: string | null; email: string }[]>({
    queryKey: ['entry-payout-reps'],
    queryFn: async () => {
      const { data: roles, error: rErr } = await (supabase as any)
        .from('user_roles')
        .select('user_id, commission_rate')
        .eq('role', 'rep');
      if (rErr) throw rErr;
      const ids = ((roles as any[]) || []).map(r => r.user_id);
      if (ids.length === 0) return [];
      const { data: profiles } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      return ((roles as any[]) || []).map(r => ({
        user_id: r.user_id,
        commission_rate: Number(r.commission_rate) || 0,
        full_name: ((profiles as any[]) || []).find(p => p.id === r.user_id)?.full_name || null,
        email: ((profiles as any[]) || []).find(p => p.id === r.user_id)?.email || '',
      }));
    },
    enabled: isPayout,
  });

  // === 佣金發放：可發放銷貨單（系統計算佣金、排除已發放） ===
  interface PayoutNote {
    id: string;
    code: string;
    storeName: string;
    shippedAt: string | null;
    commission: number;
  }
  const { data: payoutNotes = [] } = useQuery<PayoutNote[]>({
    queryKey: ['entry-payout-notes', payoutRepId],
    queryFn: async () => {
      if (!payoutRepId) return [];
      const { data: assigns, error: aErr } = await (supabase as any)
        .from('rep_store_assignments')
        .select('store_id')
        .eq('rep_id', payoutRepId);
      if (aErr) throw aErr;
      const storeIds = ((assigns as any[]) || []).map(a => a.store_id);
      if (storeIds.length === 0) return [];

      const [{ data: costsRes }, { data: payoutsRes }, { data: notesRes }, { data: wholesaleRes }] = await Promise.all([
        (supabase as any).from('rep_product_costs').select('product_id, variant_id, cost').eq('rep_id', payoutRepId),
        (supabase as any).from('rep_commission_payouts').select('sales_note_id').eq('rep_id', payoutRepId),
        (supabase as any)
          .from('sales_notes')
          .select(`
            id, code, shipped_at,
            store:stores(name),
            sales_note_items(quantity, order_item:order_items(product_id, variant_id, unit_price, unit_cost))
          `)
          .in('store_id', storeIds)
          .in('status', ['shipped', 'received'])
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('product_variants')
          .select('id, product_id, wholesale_price')
          .neq('status', 'discontinued'),
      ]);

      const costMap = new Map<string, number>();
      for (const c of (costsRes as any[]) || []) {
        costMap.set(`${c.product_id}|${c.variant_id ?? 'null'}`, Number(c.cost) || 0);
      }
      const wholesaleMap = new Map<string, number>();
      for (const w of (wholesaleRes as any[]) || []) {
        wholesaleMap.set(`${w.product_id}|${w.id}`, Number(w.wholesale_price) || 0);
      }
      const getCost = (pid: string, vid: string | null, unitCost: number) => {
        if (Number(unitCost) > 0) return Number(unitCost);
        const exact = costMap.get(`${pid}|${vid ?? 'null'}`);
        if (exact !== undefined) return exact;
        const productLevel = costMap.get(`${pid}|null`);
        if (productLevel !== undefined) return productLevel;
        return wholesaleMap.get(`${pid}|${vid ?? ''}`) ?? 0;
      };
      const paidSet = new Set(((payoutsRes as any[]) || []).map(p => p.sales_note_id));
      const repRate = (payoutReps.find(r => r.user_id === payoutRepId)?.commission_rate ?? 0) / 100;

      const notes: PayoutNote[] = [];
      for (const n of (notesRes as any[]) || []) {
        if (paidSet.has(n.id)) continue;
        let commission = 0;
        for (const sni of n.sales_note_items || []) {
          const oi = sni.order_item;
          if (!oi) continue;
          const profit = (Number(oi.unit_price) || 0) - getCost(oi.product_id, oi.variant_id ?? null, Number(oi.unit_cost) || 0);
          commission += Math.max(0, profit) * (Number(sni.quantity) || 0) * repRate;
        }
        if (commission <= 0) continue;
        notes.push({
          id: n.id,
          code: n.code || n.id.slice(0, 8),
          storeName: n.store?.name || '—',
          shippedAt: n.shipped_at,
          commission,
        });
      }
      return notes;
    },
    enabled: isPayout && !!payoutRepId,
  });

  const selectedPayoutNotes = payoutNotes.filter(n => selectedPayoutNoteIds.includes(n.id));
  const selectedPayoutTotal = selectedPayoutNotes.reduce((s, n) => s + n.commission, 0);

  const togglePayoutNote = (id: string) => {
    setSelectedPayoutNoteIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAllPayoutNotes = () => {
    const ids = payoutNotes.map(n => n.id);
    setSelectedPayoutNoteIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.includes(id));
      return allSelected ? prev.filter(x => !ids.includes(x)) : ids;
    });
  };

  // === 運費結帳：物流公司（採購商）清單（含其運費型商品） ===
  const { data: shippingSuppliers = [] } = useQuery<{ id: string; name: string; products: { id: string; name: string }[] }[]>({
    queryKey: ['shipping-suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name, products!inner(id, name, item_type)')
        .eq('is_active', true)
        .eq('products.item_type', 'shipping')
        .order('name');
      if (error) throw error;
      return (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        products: (s.products || []).filter((p: any) => p.item_type === 'shipping'),
      }));
    },
    enabled: isShipping,
  });

  // === 運費結帳：可結算的月結運費品項（排除已結算訂單） ===
  interface ShipItem {
    id: string;
    orderId: string;
    orderCode: string;
    productName: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }
  const { data: shipSettleItems = [] } = useQuery<ShipItem[]>({
    queryKey: ['shipping-settle-items', shippingSupplierId],
    queryFn: async () => {
      if (!shippingSupplierId) return [];
      const [{ data: items }, { data: periods }] = await Promise.all([
        (supabase as any)
          .from('order_items')
          .select('id, order_id, quantity, unit_price, order:orders(code, status, created_at), product:products(id, name)')
          .eq('shipping_payment', 'monthly')
          .eq('product.supplier_id', shippingSupplierId),
        (supabase as any)
          .from('shipping_settlement_periods')
          .select('id, supplier_id, is_settled, entry_id, accounting_entry_references(reference_type, reference_id)'),
      ]);

      const settledOrderIds = new Set<string>();
      for (const p of (periods as any[]) || []) {
        if (p.supplier_id !== shippingSupplierId || !p.is_settled) continue;
        for (const r of p.accounting_entry_references || []) {
          if (r.reference_type === 'order') settledOrderIds.add(r.reference_id);
        }
      }

      return ((items as any[]) || [])
        .filter((i: any) => i.order && i.order.status !== 'cancelled' && !settledOrderIds.has(i.order_id))
        .map((i: any) => {
          const qty = Number(i.quantity) || 0;
          const unitPrice = Number(i.unit_price) || 0;
          return {
            id: i.id,
            orderId: i.order_id,
            orderCode: i.order.code || i.order_id.slice(0, 8),
            productName: i.product?.name || '—',
            qty,
            unitPrice,
            amount: qty * unitPrice,
          };
        });
    },
    enabled: isShipping && !!shippingSupplierId,
  });

  const selectedShipTotal = (shipSettleItems.filter(i => selectedShipItemIds.includes(i.id)))
    .reduce((s, i) => s + i.amount, 0);

  const toggleShipItem = (id: string) => {
    setSelectedShipItemIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAllShipItems = () => {
    const ids = shipSettleItems.map(i => i.id);
    setSelectedShipItemIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.includes(id));
      return allSelected ? prev.filter(x => !ids.includes(x)) : ids;
    });
  };

  const currentDocList = useMemo(() => {
    switch (docTab) {
      case 'sales_note': return salesNotes;
      case 'purchase_order': return purchaseOrders;
      case 'repair_order': return repairOrders;
    }
  }, [docTab, salesNotes, purchaseOrders, repairOrders]);

  const addDocItem = (item: any) => {
    if (docItems.some(d => d.docType === docTab && d.docId === item.id)) return;
    const isPurchase = docTab === 'purchase_order';
    setDocItems(prev => [...prev, {
      docType: docTab,
      docId: item.id,
      code: item.code,
      name: item.name,
      date: item.date,
      originalAmount: item.amount || 0,
      amountApplied: isPurchase ? -Math.abs(item.amount || 0) : (item.amount || 0),
    }]);
  };

  const removeDocItem = (index: number) => {
    setDocItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateDocAmount = (index: number, val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return;
    setDocItems(prev => prev.map((d, i) => i === index ? { ...d, amountApplied: n } : d));
  };

  const totalAmount = isList && docItems.length > 0
    ? docItems.reduce((s, d) => s + d.amountApplied, 0)
    : parseFloat(amount) || 0;

  const autoType: EntryType = isList
    ? (totalAmount > 0 ? 'income' : 'expense')
    : (view === 'transfer' ? 'transfer' : 'currency_exchange');

  const buildSubmitData = (): { data: Partial<AccountingEntry>; references?: AccountingEntryReference[] } => {
    if (isRepair) {
      const isIncome = repairMode === 'income_repair';
      const repairType: EntryType = isIncome ? 'income' : 'expense';
      const numAmount = Math.abs(parseFloat(amount) || 0);

      let refType: string | null = null;
      let refId: string | null = null;
      const refDocItems: AccountingEntryReference[] = [];

      if (repairMode === 'income_repair' && selectedRepairOrderId) {
        refType = 'repair_order';
        refId = selectedRepairOrderId;
        const ro = repairOrders.find(r => r.id === selectedRepairOrderId);
        refDocItems.push({
          id: '',
          entry_id: '',
          reference_type: 'repair_order',
          reference_id: selectedRepairOrderId,
          item_name: `維修單 ${ro?.code || selectedRepairOrderId.slice(0, 8)}`,
          amount_applied: numAmount,
          created_at: '',
        });
      } else if (repairMode === 'expense_part' && selectedPurchaseOrderId) {
        refType = 'purchase_order';
        refId = selectedPurchaseOrderId;
        const po = purchaseOrders.find(p => p.id === selectedPurchaseOrderId);
        refDocItems.push({
          id: '',
          entry_id: '',
          reference_type: 'purchase_order',
          reference_id: selectedPurchaseOrderId,
          item_name: `採購單 ${po?.code || selectedPurchaseOrderId.slice(0, 8)}`,
          amount_applied: -numAmount,
          created_at: '',
        });
      } else if (repairMode === 'expense_service') {
        if (selectedRepairOrderId) {
          refType = 'repair_order';
          refId = selectedRepairOrderId;
          const ro = repairOrders.find(r => r.id === selectedRepairOrderId);
          refDocItems.push({
            id: '',
            entry_id: '',
            reference_type: 'repair_order',
            reference_id: selectedRepairOrderId,
            item_name: `維修服務費（${serviceVendorName || '第三方廠商'}）`,
            amount_applied: -numAmount,
            created_at: '',
          });
        }
      }

      const repairData: Partial<AccountingEntry> = {
        type: repairType,
        category_id: categoryId || null,
        account_id: accountId || null,
        amount: numAmount,
        paid_amount: numAmount,
        payment_status: 'paid',
        description: description || (
          repairMode === 'income_repair' ? '維修收款' :
          repairMode === 'expense_part' ? '維修零件款' :
          `廠商維修服務費（${serviceVendorName || '外包技術費'}）`
        ),
        transaction_date: transactionDate,
        due_date: dueDate || null,
        reference_type: refType,
        reference_id: refId,
      };

      return { data: repairData, references: refDocItems.length > 0 ? refDocItems : undefined };
    }

    const isPaid = prefill?.markAsPaid || false;
    const baseData: Partial<AccountingEntry> = {
      type: autoType,
      category_id: isList ? (categoryId || null) : null,
      account_id: accountId || null,
      transfer_to_account_id: isTransferLike ? (transferToAccountId || null) : null,
      exchange_rate: isTransferLike && exchangeRate ? parseFloat(exchangeRate) : null,
      original_currency: isTransferLike ? (originalCurrency || null) : null,
      original_amount: isTransferLike && originalAmount ? parseFloat(originalAmount) : null,
      amount: Math.abs(parseFloat(amount) || 0),
      paid_amount: isPaid ? Math.abs(parseFloat(amount) || 0) : 0,
      payment_status: isPaid ? 'paid' : 'unpaid',
      description: description || null,
      transaction_date: transactionDate,
      due_date: dueDate || null,
      reference_type: null,
      reference_id: null,
    };

    if (isList && docItems.length > 0) {
      const firstDoc = docItems[0];
      const references: AccountingEntryReference[] = docItems.map(d => ({
        id: '',
        entry_id: '',
        reference_type: d.docType,
        reference_id: d.docId,
        item_name: `${DOC_TYPE_LABELS[d.docType]} ${d.code}`,
        amount_applied: d.amountApplied,
        created_at: '',
      }));
      return {
        data: {
          ...baseData,
          reference_type: firstDoc.docType,
          reference_id: firstDoc.docId,
          counterparty_name: firstDoc.name || null,
        },
        references,
      };
    }

    return { data: baseData };
  };

  const canSubmit = isPaymentMode
    ? accountId && (parseFloat(paymentAmount) || 0) > 0
    : isPayout
      ? !!(payoutRepId && accountId && selectedPayoutNoteIds.length > 0 && selectedPayoutTotal > 0)
      : isShipping
        ? !!(shippingSupplierId && shippingPeriodStart && shippingPeriodEnd && accountId && selectedShipItemIds.length > 0 && selectedShipTotal > 0)
        : isRepair
          ? !!(accountId && (parseFloat(amount) || 0) > 0)
          : entry
            ? accountId && (parseFloat(amount) || 0) > 0
            : accountId && (isList ? docItems.length > 0 && totalAmount !== 0 : (parseFloat(amount) || 0) > 0);

  const handleSubmit = () => {
    if (isPayout) {
      if (selectedPayoutNoteIds.length === 1 && onPayoutSubmit) {
        const note = payoutNotes.find(n => n.id === selectedPayoutNoteIds[0]);
        if (note) {
          onPayoutSubmit({
            repId: payoutRepId,
            salesNoteId: note.id,
            paidDate: transactionDate,
            accountId,
            categoryId: categoryId || null,
            description: description || undefined,
            note: description || undefined,
          });
        }
      } else if (selectedPayoutNoteIds.length > 1 && onBatchPayoutSubmit) {
        onBatchPayoutSubmit({
          repId: payoutRepId,
          salesNoteIds: selectedPayoutNoteIds,
          paidDate: transactionDate,
          accountId,
          categoryId: categoryId || null,
          description: description || undefined,
        });
      }
    } else if (isShipping && onShippingSettleSubmit) {
      onShippingSettleSubmit({
        supplierId: shippingSupplierId,
        orderItemIds: selectedShipItemIds,
        periodStart: shippingPeriodStart,
        periodEnd: shippingPeriodEnd,
        paidDate: transactionDate,
        accountId,
        categoryId: categoryId || null,
        description: description || undefined,
        note: description || undefined,
      });
    } else if (isPaymentMode && paymentEntry && onRecordPayment) {
      onRecordPayment({
        entryId: paymentEntry.id,
        amount: parseFloat(paymentAmount),
        accountId,
      });
    } else {
      const { data, references } = buildSubmitData();
      onSubmit(data, references);
    }
  };

  return (
    <div className="space-y-4">
      {/* === View Switcher === */}
      {!isPaymentMode && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={isList ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleViewChange('list')}
            disabled={!!entry}
          >
            記錄收支
          </Button>
          <Button
            variant={view === 'transfer' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleViewChange('transfer')}
            disabled={!!entry}
          >
            帳戶互轉
          </Button>
          <Button
            variant={view === 'currency_exchange' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleViewChange('currency_exchange')}
            disabled={!!entry}
          >
            幣值換算
          </Button>
          <Button
            variant={isPayout ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleViewChange('payout')}
            disabled={!!entry}
          >
            <HandCoins className="h-4 w-4 mr-1" /> 佣金發放
          </Button>
          <Button
            variant={isShipping ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleViewChange('shipping')}
            disabled={!!entry}
          >
            <Truck className="h-4 w-4 mr-1" /> 運費結帳
          </Button>
          <Button
            variant={isRepair ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleViewChange('repair')}
            disabled={!!entry}
          >
            <Wrench className="h-4 w-4 mr-1" /> 維修收支
          </Button>
        </div>
      )}

      {/* === Payment Mode === */}
      {isPaymentMode && paymentEntry && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          <div>
            <Label>待付金額</Label>
            <p className="text-2xl font-bold">
              {formatCurrency(paymentEntry.amount - paymentEntry.paid_amount)}
            </p>
          </div>
          <div className="space-y-2">
            <Label>付款金額</Label>
            <Input
              type="number"
              value={paymentAmount}
              onChange={e => setPaymentAmount(e.target.value)}
              placeholder="輸入付款金額"
            />
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
      )}

      {/* === Transfer / Currency Exchange === */}
      {isTransferLike && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>來源帳戶</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="選擇來源帳戶" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountId && <p className="text-xs text-muted-foreground">幣別：{sourceCurrency}</p>}
            </div>
            <div className="space-y-2">
              <Label>目的地帳戶</Label>
              <Select value={transferToAccountId} onValueChange={setTransferToAccountId}>
                <SelectTrigger><SelectValue placeholder="選擇目的地帳戶" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.id !== accountId).map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {transferToAccountId && <p className="text-xs text-muted-foreground">幣別：{destCurrency}</p>}
            </div>
          </div>

          {accountId && transferToAccountId && sourceCurrency !== destCurrency && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>原始幣別</Label>
                <Select value={originalCurrency} onValueChange={setOriginalCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>原始金額</Label>
                <Input type="number" value={originalAmount} onChange={e => setOriginalAmount(e.target.value)} placeholder="轉換前金額" />
              </div>
              <div className="space-y-2">
                <Label>匯率（1 {originalCurrency || sourceCurrency} = ? {destCurrency}）</Label>
                <Input type="number" step="0.0001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} placeholder="匯率" />
              </div>
            </div>
          )}

          {accountId && transferToAccountId && sourceCurrency === destCurrency && (
            <div className="space-y-2">
              <Label>金額</Label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="輸入轉帳金額" />
              <p className="text-xs text-muted-foreground">同幣別轉帳，無需匯率</p>
            </div>
          )}

          {accountId && transferToAccountId && sourceCurrency !== destCurrency && exchangeRate && originalAmount && (
            <div className="p-3 bg-background rounded-md border">
              <p className="text-sm text-muted-foreground">換算結果</p>
              <p className="text-lg font-bold">
                {originalAmount} {originalCurrency || sourceCurrency} × {exchangeRate} = {amount} {destCurrency}
              </p>
            </div>
          )}
        </div>
      )}

      {/* === Document List (Income / Expense) === */}
      {isList && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>帳戶</Label>
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
            {allCategories.length > 0 && (
              <div className="space-y-2">
                <Label>分類</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="選擇分類（選填）" /></SelectTrigger>
                  <SelectContent>
                    {allCategories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {cat.type === 'income' ? '收入' : '支出'}
                        </Badge>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Auto type indicator */}
          {docItems.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">自動判定：</span>
              <Badge variant={autoType === 'income' ? 'default' : 'destructive'}>
                {autoType === 'income' ? '收入' : '支出'}
              </Badge>
              <span className="text-sm font-bold" style={{ color: autoType === 'income' ? '#16a34a' : 'hsl(var(--destructive))' }}>
                {autoType === 'income' ? '+' : ''}{formatCurrency(totalAmount)}
              </span>
            </div>
          )}

          {/* Document picker tabs */}
          <div className="space-y-2">
            <Label>選擇單據</Label>
            <div className="flex gap-2">
              {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map(dt => (
                <Button
                  key={dt}
                  variant={docTab === dt ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDocTab(dt)}
                >
                  {DOC_TYPE_LABELS[dt]}
                </Button>
              ))}
            </div>

            <div className="border rounded-md max-h-[180px] overflow-y-auto bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>單號</TableHead>
                    <TableHead>名稱</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentDocList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">無資料</TableCell>
                    </TableRow>
                  ) : (
                    currentDocList.map(item => {
                      const alreadyAdded = docItems.some(d => d.docType === docTab && d.docId === item.id);
                      return (
                        <TableRow key={item.id} className={alreadyAdded ? 'opacity-40' : ''}>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => addDocItem(item)}
                              disabled={alreadyAdded}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{item.code}</TableCell>
                          <TableCell className="text-sm line-clamp-1">{item.name}</TableCell>
                          <TableCell className="text-xs">{format(new Date(item.date), 'MM/dd')}</TableCell>
                          <TableCell className="text-right text-sm">
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Added items list */}
          {docItems.length > 0 && (
            <div className="space-y-2">
              <Label>已加入單據（可調整金額）</Label>
              <div className="border rounded-md bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>類型</TableHead>
                      <TableHead>項目</TableHead>
                      <TableHead className="text-right w-[120px]">金額</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docItems.map((d, i) => (
                      <TableRow key={`${d.docType}-${d.docId}`}>
                        <TableCell><Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[d.docType]}</Badge></TableCell>
                        <TableCell className="text-sm">{d.code} {d.name}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={d.amountApplied}
                            onChange={e => updateDocAmount(i, e.target.value)}
                            className="h-8 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={() => removeDocItem(i)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={2}>合計</TableCell>
                      <TableCell className="text-right">
                        <span style={{ color: totalAmount >= 0 ? '#16a34a' : 'hsl(var(--destructive))' }}>
                          {totalAmount >= 0 ? '+' : ''}{formatCurrency(totalAmount)}
                        </span>
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === Payout（佣金發放：單筆或批次） === */}
      {isPayout && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          <div className="space-y-2">
            <Label>業務</Label>
            <Select value={payoutRepId} onValueChange={v => { setPayoutRepId(v); setSelectedPayoutNoteIds([]); }}>
              <SelectTrigger><SelectValue placeholder="選擇業務" /></SelectTrigger>
              <SelectContent>
                {payoutReps.map(r => (
                  <SelectItem key={r.user_id} value={r.user_id}>
                    {r.full_name || r.email || r.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {payoutReps.length === 0 && (
              <p className="text-xs text-muted-foreground">尚無業務身分使用者</p>
            )}
          </div>

          {payoutRepId && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>選擇待發放銷貨單（佣金由系統計算，可複選批次發放）</Label>
                  {payoutNotes.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={toggleAllPayoutNotes}>
                      全選 / 取消全選
                    </Button>
                  )}
                </div>
                <div className="border rounded-md max-h-[240px] overflow-y-auto bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>單號</TableHead>
                        <TableHead>店鋪</TableHead>
                        <TableHead>出貨日期</TableHead>
                        <TableHead className="text-right">佣金</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payoutNotes.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                            無待發放銷貨單
                          </TableCell>
                        </TableRow>
                      ) : (
                        payoutNotes.map(note => (
                          <TableRow
                            key={note.id}
                            className={`cursor-pointer ${selectedPayoutNoteIds.includes(note.id) ? 'bg-muted' : 'hover:bg-muted/50'}`}
                            onClick={() => togglePayoutNote(note.id)}
                          >
                            <TableCell onClick={e => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedPayoutNoteIds.includes(note.id)}
                                onCheckedChange={() => togglePayoutNote(note.id)}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{note.code}</TableCell>
                            <TableCell className="text-sm">{note.storeName}</TableCell>
                            <TableCell className="text-xs">
                              {note.shippedAt ? format(new Date(note.shippedAt), 'MM/dd') : '—'}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {formatCurrency(note.commission)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {selectedPayoutNoteIds.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md border bg-background">
                  <span className="text-sm text-muted-foreground">
                    已選 {selectedPayoutNoteIds.length} 筆發放金額（系統計算，不可更改）：
                  </span>
                  <span className="font-bold">{formatCurrency(selectedPayoutTotal)}</span>
                </div>
              )}

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
            </>
          )}
        </div>
      )}

      {/* === Shipping（運費月結結帳：選物流商 + 期間 + 品項） === */}
      {isShipping && (
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
      )}

      {/* === Repair Mode (維修專用收支) === */}
      {isRepair && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          {/* 子模式切換：收維修錢 / 付零件錢 / 給廠商服務費 */}
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

          {/* 關聯維修單 (收維修錢模式) */}
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

          {/* 關聯採購單 (付零件錢模式) */}
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

          {/* 廠商服務費 (外包/加工工資，不走庫存) */}
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

          {/* 帳戶與金額 */}
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

          {/* 分類選擇 */}
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
      )}

      {/* === Common: description, dates === */}
      <div className="space-y-2">
        <Label>說明</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="輸入說明" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>交易日期</Label>
          <Input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>到期日（選填）</Label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isLoading}
        >
          {isLoading
            ? '處理中...'
            : isPaymentMode
            ? '確認付款'
            : isPayout
            ? '確認發放'
            : isShipping
            ? '確認結帳'
            : isRepair
            ? (repairMode === 'income_repair' ? '確認維修收款' : repairMode === 'expense_part' ? '確認支付零件款' : '確認支付服務費')
            : entry
            ? '更新'
            : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}