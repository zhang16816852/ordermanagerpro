import { AccountingEntry, AccountingEntryReference, EntryType } from '../types';
import { DocItem, DOC_TYPE_LABELS, RepairAccountingSubType } from './EntryFormTypes';
import { DocCandidate } from './useEntryDocQueries';

export interface BuildSubmitDataInput {
  isList: boolean;
  isRepair: boolean;
  isTransferLike: boolean;
  view: string;
  repairMode: RepairAccountingSubType;
  repairOrders: DocCandidate[];
  purchaseOrders: DocCandidate[];
  selectedRepairOrderId: string;
  selectedPurchaseOrderId: string;
  serviceVendorName: string;
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
  markAsPaid: boolean;
  totalAmount: number;
}

export function buildSubmitData(input: BuildSubmitDataInput): { data: Partial<AccountingEntry>; references?: AccountingEntryReference[] } {
  const {
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
    markAsPaid,
    totalAmount,
  } = input;

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

  const autoType: EntryType = isList
    ? (totalAmount > 0 ? 'income' : 'expense')
    : (view === 'transfer' ? 'transfer' : 'currency_exchange');

  const isPaid = markAsPaid;
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
}