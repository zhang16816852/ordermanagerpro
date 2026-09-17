import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { AccountingEntry, AccountingCategory, Account, EntryType } from '../types';
import { formatCurrency } from '@/lib/formatters';
import { useEntryDocQueries, DocCandidate } from './useEntryDocQueries';
import { useEntryPayoutQueries } from './useEntryPayoutQueries';
import { useEntryShippingQueries, ShippingSupplier } from './useEntryShippingQueries';
import { buildSubmitData } from './entrySubmitData';
import {
  DocItem,
  DocType,
  EntryFormProps,
  FormView,
  PayoutNote,
  PayoutRep,
  RepairAccountingSubType,
  ShipItem,
  EntryPrefill,
  PayoutSubmission,
  BatchPayoutSubmission,
  ShippingSettlementSubmission,
} from './EntryFormTypes';

export interface EntryFormController {
  entry: AccountingEntry | null;
  paymentEntry?: AccountingEntry | null;
  prefill?: EntryPrefill | null;
  categories: AccountingCategory[];
  accounts: Account[];
  isLoading: boolean;
  view: FormView;
  categoryId: string;
  accountId: string;
  transferToAccountId: string;
  exchangeRate: string;
  originalCurrency: string;
  originalAmount: string;
  amount: string;
  description: string;
  transactionDate: string;
  dueDate: string;
  docItems: DocItem[];
  docTab: DocType;
  currentDocList: DocCandidate[];
  payoutRepId: string;
  selectedPayoutNoteIds: string[];
  shippingSupplierId: string;
  shippingPeriodStart: string;
  shippingPeriodEnd: string;
  selectedShipItemIds: string[];
  repairMode: RepairAccountingSubType;
  selectedRepairOrderId: string;
  selectedPurchaseOrderId: string;
  serviceVendorName: string;
  paymentAmount: string;
  salesNotes: DocCandidate[];
  purchaseOrders: DocCandidate[];
  repairOrders: DocCandidate[];
  payoutReps: PayoutRep[];
  payoutNotes: PayoutNote[];
  shippingSuppliers: ShippingSupplier[];
  shipSettleItems: ShipItem[];
  sourceCurrency: string;
  destCurrency: string;
  isList: boolean;
  isTransferLike: boolean;
  isPayout: boolean;
  isShipping: boolean;
  isRepair: boolean;
  isPaymentMode: boolean;
  allCategories: AccountingCategory[];
  payoutCategories: AccountingCategory[];
  selectedPayoutTotal: number;
  selectedShipTotal: number;
  totalAmount: number;
  autoType: EntryType;
  canSubmit: boolean;
  setCategoryId: (v: string) => void;
  setAccountId: (v: string) => void;
  setTransferToAccountId: (v: string) => void;
  setExchangeRate: (v: string) => void;
  setOriginalCurrency: (v: string) => void;
  setOriginalAmount: (v: string) => void;
  setAmount: (v: string) => void;
  setDescription: (v: string) => void;
  setTransactionDate: (v: string) => void;
  setDueDate: (v: string) => void;
  setDocTab: (v: DocType) => void;
  setPayoutRepId: (v: string) => void;
  setSelectedPayoutNoteIds: (v: string[]) => void;
  setShippingSupplierId: (v: string) => void;
  setShippingPeriodStart: (v: string) => void;
  setShippingPeriodEnd: (v: string) => void;
  setSelectedShipItemIds: (v: string[]) => void;
  setSelectedRepairOrderId: (v: string) => void;
  setSelectedPurchaseOrderId: (v: string) => void;
  setServiceVendorName: (v: string) => void;
  setPaymentAmount: (v: string) => void;
  addDocItem: (item: DocCandidate) => void;
  removeDocItem: (index: number) => void;
  updateDocAmount: (index: number, val: string) => void;
  togglePayoutNote: (id: string) => void;
  toggleAllPayoutNotes: () => void;
  toggleShipItem: (id: string) => void;
  toggleAllShipItems: () => void;
  handleViewChange: (v: FormView) => void;
  handleRepairModeChange: (mode: RepairAccountingSubType) => void;
  handleSubmit: () => void;
}

export function useEntryFormController(props: EntryFormProps): EntryFormController {
  const { entry, paymentEntry, prefill, categories, accounts, onSubmit, onRecordPayment, onPayoutSubmit, onBatchPayoutSubmit, onShippingSettleSubmit, isLoading } = props;
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

  const [shippingSupplierId, setShippingSupplierId] = useState(prefill?.shipping?.supplierId || '');
  const [shippingPeriodStart, setShippingPeriodStart] = useState(prefill?.shipping?.periodStart || '');
  const [shippingPeriodEnd, setShippingPeriodEnd] = useState(prefill?.shipping?.periodEnd || '');
  const [selectedShipItemIds, setSelectedShipItemIds] = useState<string[]>(prefill?.shipping?.orderItemIds || []);

  const [repairMode, setRepairMode] = useState<RepairAccountingSubType>(prefill?.repair?.subType || 'income_repair');
  const [selectedRepairOrderId, setSelectedRepairOrderId] = useState<string>(prefill?.repair?.repairOrderId || '');
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string>(prefill?.repair?.purchaseOrderId || '');
  const [serviceVendorName, setServiceVendorName] = useState<string>(prefill?.repair?.vendorName || '');

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

  const { salesNotes, purchaseOrders, repairOrders } = useEntryDocQueries({ isList, isRepair, docTab });
  const { payoutReps, payoutNotes } = useEntryPayoutQueries({ isPayout, payoutRepId });
  const { shippingSuppliers, shipSettleItems } = useEntryShippingQueries({ isShipping, shippingSupplierId });

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

  const addDocItem = (item: DocCandidate) => {
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

  const canSubmit = isPaymentMode
    ? !!(accountId && (parseFloat(paymentAmount) || 0) > 0)
    : isPayout
      ? !!(payoutRepId && accountId && selectedPayoutNoteIds.length > 0 && selectedPayoutTotal > 0)
      : isShipping
        ? !!(shippingSupplierId && shippingPeriodStart && shippingPeriodEnd && accountId && selectedShipItemIds.length > 0 && selectedShipTotal > 0)
        : isRepair
          ? !!(accountId && (parseFloat(amount) || 0) > 0)
          : entry
            ? !!(accountId && (parseFloat(amount) || 0) > 0)
            : !!(accountId && (isList ? docItems.length > 0 && totalAmount !== 0 : (parseFloat(amount) || 0) > 0));

  const handleSubmit = useCallback(() => {
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
      const { data, references } = buildSubmitData({
        isList,
        isRepair,
        isTransferLike,
        view,
        repairMode,
        repairOrders,
        purchaseOrders,
        selectedRepairOrderId,
        selectedPurchaseOrderId,
        serviceVendorName,
        categoryId,
        accountId,
        transferToAccountId,
        exchangeRate,
        originalCurrency,
        originalAmount,
        amount,
        description,
        transactionDate,
        dueDate,
        docItems,
        markAsPaid: prefill?.markAsPaid || false,
        totalAmount,
      });
      onSubmit(data, references);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayout, onPayoutSubmit, selectedPayoutNoteIds, payoutNotes, payoutRepId, transactionDate, accountId, categoryId, description, onBatchPayoutSubmit, isShipping, onShippingSettleSubmit, shippingSupplierId, selectedShipItemIds, shippingPeriodStart, shippingPeriodEnd, isPaymentMode, paymentEntry, onRecordPayment, paymentAmount, isList, isRepair, isTransferLike, view, repairMode, repairOrders, purchaseOrders, selectedRepairOrderId, selectedPurchaseOrderId, serviceVendorName, exchangeRate, originalCurrency, originalAmount, amount, dueDate, docItems, prefill, totalAmount, onSubmit]);

  return {
    entry,
    paymentEntry,
    prefill,
    categories,
    accounts,
    isLoading,
    view,
    categoryId,
    accountId,
    transferToAccountId,
    exchangeRate,
    originalCurrency,
    originalAmount,
    amount,
    description,
    transactionDate,
    dueDate,
    docItems,
    docTab,
    currentDocList,
    payoutRepId,
    selectedPayoutNoteIds,
    shippingSupplierId,
    shippingPeriodStart,
    shippingPeriodEnd,
    selectedShipItemIds,
    repairMode,
    selectedRepairOrderId,
    selectedPurchaseOrderId,
    serviceVendorName,
    paymentAmount,
    salesNotes,
    purchaseOrders,
    repairOrders,
    payoutReps,
    payoutNotes,
    shippingSuppliers,
    shipSettleItems,
    sourceCurrency,
    destCurrency,
    isList,
    isTransferLike,
    isPayout,
    isShipping,
    isRepair,
    isPaymentMode,
    allCategories,
    payoutCategories,
    selectedPayoutTotal,
    selectedShipTotal,
    totalAmount,
    autoType,
    canSubmit,
    setCategoryId,
    setAccountId,
    setTransferToAccountId,
    setExchangeRate,
    setOriginalCurrency,
    setOriginalAmount,
    setAmount,
    setDescription,
    setTransactionDate,
    setDueDate,
    setDocTab,
    setPayoutRepId,
    setSelectedPayoutNoteIds,
    setShippingSupplierId,
    setShippingPeriodStart,
    setShippingPeriodEnd,
    setSelectedShipItemIds,
    setSelectedRepairOrderId,
    setSelectedPurchaseOrderId,
    setServiceVendorName,
    setPaymentAmount,
    addDocItem,
    removeDocItem,
    updateDocAmount,
    togglePayoutNote,
    toggleAllPayoutNotes,
    toggleShipItem,
    toggleAllShipItems,
    handleViewChange,
    handleRepairModeChange,
    handleSubmit,
  };
}

export type { EntryType };