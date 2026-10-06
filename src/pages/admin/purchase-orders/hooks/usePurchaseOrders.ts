import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  PurchaseOrder, Supplier, PurchaseOrderItem, ProductWithPrice, PurchaseOrderStatus,
  type PoItemWritePayload, type PoUpdateItemsArgs, type PoWriteResult,
} from '../types';
import { LotInput } from '@/utils/lotTracking';
import {
  computePurchasePaidTotals,
  type PurchasePaidEntry,
  type PurchasePaidRef,
} from '../paymentSummary';
import type { Account, AccountingCategory, AccountingEntry, AccountingEntryReference } from '@/pages/admin/accounting/types';

/** 記錄付款的 payload：`orderIds` 為權威單據清單，references 由 EntryForm 產生 */
export interface RecordPaymentPayload {
  orderIds: string[];
  data: Partial<AccountingEntry>;
  references?: AccountingEntryReference[];
}

export interface PurchaseOrderFilters {
  supplierId?: string;
  purpose?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 採購單表頭／品項寫入的唯一 RPC 入口（20260930000005）。
 *
 * 這裡是全站唯一需要把 optional 參數轉成「可傳 null」的地方：
 * generated types 將 p_* 標為 `?: string`（省略即 DEFAULT NULL），
 * 但語意上必須區分「明確傳 null ＝ 不變更」與「傳 '' ＝ 清空」，
 * 欄位則由 PoUpdateItemsArgs 把關。回傳 { ok:false, reason } 一律轉為 throw，
 * 讓呼叫端只需處理 throw 與成功兩種路徑。
 */
async function rpcUpdatePurchaseOrder(args: PoUpdateItemsArgs): Promise<PoWriteResult | null> {
  const { data, error } = await supabase.rpc('update_purchase_order_with_items', {
    ...args,
  } as unknown as Database['public']['Functions']['update_purchase_order_with_items']['Args']);
  if (error) throw error;
  const res = data as PoWriteResult | null;
  if (res && res.ok === false) throw new Error(res.reason || '更新失敗');
  return res;
}

export function usePurchaseOrders(viewingOrderId?: string, filters?: PurchaseOrderFilters) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // Queries
  const { data: suppliers = [], isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Supplier[];
    },
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['purchase-orders', suppliers, filters],
    queryFn: async () => {
      let query = (supabase as any)
        .from('purchase_orders')
        .select('*');
      if (filters?.supplierId && filters.supplierId !== 'all') {
        query = query.eq('supplier_id', filters.supplierId);
      }
      if (filters?.purpose && filters.purpose !== 'all') {
        query = query.eq('purpose', filters.purpose);
      }
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters?.dateFrom) {
        query = query.gte('order_date', filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte('order_date', filters.dateTo);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      return ((data || []) as any[]).map((order) => ({
        ...order,
        supplier: suppliers.find(s => s.id === order.supplier_id),
      })) as PurchaseOrder[];
    },
    enabled: suppliers.length >= 0,
  });

  // 付款彙總：purchase_orders 沒有 payment_status／paid_amount，已付金額只能來自會計模組。
  //
  // 分攤規則（見 computePurchasePaidTotals）：
  //   1. 一筆分錄的 paid_amount 對應「整張分錄」，不是每張單據，故須依該分錄
  //      對每張參照單據的 amount_applied 比例分攤。
  //   2. 同一筆分錄可能同時出現在兩條參照路徑（會計分錄「清單」模式會把第一張單據寫進
  //      accounting_entries.reference_id，同時把全部單據寫進 accounting_entry_references
  //      子表，見 entrySubmitData.buildSubmitData），因此以「採購單 + 分錄 id」為鍵去重，
  //      否則該單的已付金額會被重複加總。
  const visibleOrderIds = useMemo(() => orders.map((o) => o.id), [orders]);

  const { data: paidAmountMap = {}, isLoading: paidAmountsLoading } = useQuery({
    queryKey: ['purchase-order-paid-amounts', visibleOrderIds],
    queryFn: async () => {
      if (visibleOrderIds.length === 0) return {};

      const [entryRes, refRes] = await Promise.all([
        (supabase as any)
          .from('accounting_entries')
          .select('id, reference_id, amount, paid_amount')
          .eq('reference_type', 'purchase_order')
          .in('reference_id', visibleOrderIds),
        (supabase as any)
          .from('accounting_entry_references')
          .select('entry_id, reference_id, amount_applied')
          .eq('reference_type', 'purchase_order')
          .in('reference_id', visibleOrderIds),
      ]);
      if (entryRes.error) throw entryRes.error;
      if (refRes.error) throw refRes.error;

      const entryRows = (entryRes.data || []) as PurchasePaidRef[];
      const subRefs = (refRes.data || []) as PurchasePaidRef[];

      // 跨單結帳時，採購單可能不是該分錄的第一張單據，分錄的 reference_type 就不會是
      // purchase_order，上面的查詢撈不到它的 amount／paid_amount，該單會被誤判為未付。
      // 故補撈這些「只出現在子表」的分錄。
      const knownEntryIds = new Set(entryRows.map((r) => r.entry_id));
      const missingEntryIds = [...new Set(
        subRefs.map((r) => r.entry_id).filter((id): id is string => !!id && !knownEntryIds.has(id)),
      )];

      let entries = (entryRes.data || []) as PurchasePaidEntry[];
      if (missingEntryIds.length > 0) {
        const { data, error } = await (supabase as any)
          .from('accounting_entries')
          .select('id, amount, paid_amount')
          .in('id', missingEntryIds);
        if (error) throw error;
        entries = [...entries, ...((data || []) as PurchasePaidEntry[])];
      }

      return computePurchasePaidTotals(entries, entryRows, subRefs);
    },
    // accounting_entries 的 RLS 僅 admin 可讀；業務身分看不到付款資料，
    // 與其顯示「全部未付」的假象，不如不查也不顯示。
    enabled: isAdmin === true && visibleOrderIds.length > 0,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-purchase'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('products') as any)
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data as ProductWithPrice[];
    },
  });

  const { data: orderItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['purchase-order-items', viewingOrderId],
    queryFn: async () => {
      if (!viewingOrderId) return [];
      const { data, error } = await (supabase as any)
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', viewingOrderId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Get product info
      const productIds = (data || []).map((item: any) => item.product_id).filter(Boolean);
      let productMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prods } = await (supabase
          .from('products') as any)
          .select('id, name, code')
          .in('id', productIds);
        productMap = (prods || []).reduce((acc, p) => ({ ...acc, [p.id]: p }), {});
      }

      // Get variant info
      const variantIds = (data || []).map((item: any) => item.variant_id).filter(Boolean);
      let variantMap: Record<string, any> = {};
      if (variantIds.length > 0) {
        const { data: variants } = await (supabase
          .from('product_variants') as any)
          .select('id, name, sku, tracking_mode')
          .in('id', variantIds);
        variantMap = (variants || []).reduce((acc, v) => ({ ...acc, [v.id]: v }), {});
      }

      return ((data || []) as any[]).map((item) => ({
        ...item,
        product: productMap[item.product_id],
        variant: variantMap[item.variant_id],
      })) as PurchaseOrderItem[];
    },
    enabled: !!viewingOrderId,
  });

  // Fetch supplier product mappings for vendor code/name in exports
  const viewingOrder = viewingOrderId ? orders.find(o => o.id === viewingOrderId) : null;
  const { data: supplierMappingMap = {} } = useQuery({
    queryKey: ['supplier-mappings-export', viewingOrder?.supplier_id],
    queryFn: async () => {
      if (!viewingOrder?.supplier_id) return {};
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('internal_product_id, internal_variant_id, vendor_product_id, vendor_product_name, is_primary')
        .eq('supplier_id', viewingOrder.supplier_id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      // 同一料號可對多個內部目標，反向查詢（目標 → 料號）時以主對照優先
      return (data || []).reduce((acc: Record<string, { vendor_product_id: string; vendor_product_name: string; is_primary: boolean }>, m: any) => {
        const key = `${m.internal_product_id}_${m.internal_variant_id || 'null'}`;
        const existing = acc[key];
        if (existing && existing.is_primary) return acc;
        acc[key] = { vendor_product_id: m.vendor_product_id, vendor_product_name: m.vendor_product_name, is_primary: !!m.is_primary };
        return acc;
      }, {});
    },
    enabled: !!viewingOrder?.supplier_id,
  });

  // Fetch source order codes for display
  const allSourceOrderIds = [...new Set(orderItems.flatMap(item => item.source_order_ids || []))];
  const { data: sourceOrderMap = {} } = useQuery({
    queryKey: ['source-order-codes', allSourceOrderIds],
    queryFn: async () => {
      if (allSourceOrderIds.length === 0) return {};
      const { data, error } = await (supabase as any)
        .from('orders')
        .select('id, code')
        .in('id', allSourceOrderIds);
      if (error) throw error;
      return (data || []).reduce((acc: Record<string, string>, o: any) => {
        acc[o.id] = o.code || o.id.slice(0, 8);
        return acc;
      }, {});
    },
    enabled: allSourceOrderIds.length > 0,
  });

  // Mutations
  // 表頭更新一律走交易化 RPC（20260930000005）：內含狀態合法性、收貨鎖定、
  // 已取消鎖品項與 total_amount 重算；不可用裸 insert/update 繞過守門。
  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<PurchaseOrder> & { id: string }) => {
      // null = 不變更（RPC 以 COALESCE 保留原值）；notes 需以原字串送出才能清空
      return rpcUpdatePurchaseOrder({
        p_purchase_order_id: id,
        p_notes: data.notes === undefined ? null : data.notes,
        p_items: [],
        p_deleted_item_ids: [],
        p_status: data.status ?? null,
        p_order_date: data.order_date || null,
        p_expected_date: data.expected_date || null,
        p_purpose: data.purpose ?? null,
        p_supplier_order_number: data.supplier_order_number ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order'] });
      toast.success('採購訂單已更新');
    },
    onError: (error: Error) => toast.error(error?.message || '更新失敗'),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc('delete_purchase_order_if_empty', {
        p_purchase_order_id: id,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string; adopted_by?: unknown };
      if (!res?.ok) {
        let reason = res?.reason || '刪除失敗';
        const blocks = res?.adopted_by as Array<{ label?: string }> | undefined;
        if (Array.isArray(blocks) && blocks.length > 0) {
          reason = `${reason}（${blocks.map((b) => b?.label).filter(Boolean).join('、')}）`;
        }
        throw new Error(reason);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('採購訂單已刪除');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '刪除失敗'),
  });

  const createSupplierMutation = useMutation({
    mutationFn: async (data: Partial<Supplier>) => {
      const { error } = await (supabase as any).from('suppliers').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-methods-logistics-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-suppliers'] });
      toast.success('供應商已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const updateSupplierMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Supplier> & { id: string }) => {
      const { error } = await (supabase as any).from('suppliers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-methods-logistics-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-suppliers'] });
      toast.success('供應商已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  // 品項寫入唯一路徑：整單品項一次送出，伺服端依序重編 sort_order、重算 total_amount
  // 並執行守門（已收貨不可降量／刪除／換商品、已取消單鎖品項）。不可用裸 insert/update 繞過。
  const callWriteItems = async (
    purchaseOrderId: string,
    items: Array<Omit<PoItemWritePayload, 'id'> & { id: string | null }>,
    deletedItemIds: string[] = [],
  ) => {
    return rpcUpdatePurchaseOrder({
      p_purchase_order_id: purchaseOrderId,
      p_notes: null,
      p_items: items,
      p_deleted_item_ids: deletedItemIds,
      p_status: null,
      p_order_date: null,
      p_expected_date: null,
      p_purpose: null,
      p_supplier_order_number: null,
    });
  };

  const invalidateItemWrites = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };

  const updateItemMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items }: { purchaseOrderId: string; items: PoItemWritePayload[] }) => {
      await callWriteItems(purchaseOrderId, items);
    },
    onSuccess: () => {
      invalidateItemWrites();
      toast.success('品項已更新');
    },
    onError: (e) => toast.error(getErrorMessage(e, '更新失敗')),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items, deletedItemIds }: {
      purchaseOrderId: string;
      items: PoItemWritePayload[];
      deletedItemIds: string[];
    }) => {
      await callWriteItems(purchaseOrderId, items, deletedItemIds);
    },
    onSuccess: () => {
      invalidateItemWrites();
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('品項已刪除');
    },
    onError: (e) => toast.error(getErrorMessage(e, '刪除失敗')),
  });

  const reorderItemsMutation = useMutation({
    mutationFn: async (items: PurchaseOrderItem[]) => {
      const p_items = items.map((item, index) => ({
        id: item.id,
        sort_order: index + 1,
      }));
      const { error } = await (supabase as any)
        .rpc('reorder_purchase_order_items', { p_items });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateItemWrites();
      toast.success('品項順序已更新');
    },
    onError: (e) => toast.error(getErrorMessage(e, '更新順序失敗')),
  });

  const importItemsMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items }: {
      purchaseOrderId: string;
      /** 整單品項：既有品項帶 id，新品項 id 為 null */
      items: Array<Omit<PoItemWritePayload, 'id'> & { id: string | null }>;
    }) => {
      if (!items || items.length === 0) return;
      await callWriteItems(purchaseOrderId, items);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', variables.purchaseOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('採購品項已匯入');
    },
    onError: (e) => toast.error(getErrorMessage(e, '匯入失敗')),
  });

  const receiveItemsMutation = useMutation({
    mutationFn: async (params: {
      items: { id: string; received_quantity: number; warehouse_id?: string; lots?: LotInput }[];
    }) => {
      const { items } = params;

      // Build payload for receive_purchase_items RPC (now handles UPDATE + status atomically)
      const po = orders.find(o => o.id === viewingOrderId);
      const poCode = po?.supplier_order_number || viewingOrderId || '';
      const rpcItems = items.map(item => {
        const orderItem = orderItems.find(i => i.id === item.id);
        return {
          id: item.id,
          product_id: orderItem?.product_id,
          variant_id: orderItem?.variant_id || null,
          received_quantity: item.received_quantity,
          purchase_order_id: viewingOrderId,
          purchase_order_code: poCode,
          warehouse_id: item.warehouse_id || null,
        };
      });

      const rpcLots = items
        .filter(item => item.lots)
        .map(item => ({ purchase_order_item_id: item.id, ...item.lots } as Record<string, unknown>));

      const { error: rpcError } = await (supabase as any)
        .rpc('receive_purchase_items', {
          p_items: rpcItems,
          p_warehouse_id: null,
          p_lots: rpcLots.length > 0 ? rpcLots : null,
        });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      toast.success('收貨已記錄');
    },
    onError: () => toast.error('記錄失敗'),
  });

  /**
   * 付款帳戶（含目前的 balance）。
   *
   * ⚠️ 這支 query 不能只在付款視窗開啟時才 enabled：`recordPaymentMutation`
   * 需要用 `account.balance` 做餘額增減，若此刻帳戶尚未載入就會拿不到帳戶，
   * 造成「分錄與 references 都建立、餘額卻沒動」的靜默錯誤。
   * 付款本來就限管理員（`canSeePayments: isAdmin === true`），故以角色開關。
   */
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('accounts').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
  });

  /**
   * 會計分類（EntryDialog 選單用）。
   *
   * ⚠️ queryKey 刻意與 `useAccounting`／`SalesNoteDetailDialog` 的
   * `['accounting-categories']` 共用，讓 react-query 去重、避免同一份分類
   * 打兩次 DB（不同 key 會各自快取一份，切換頁面時還會不同步）。
   */
  const { data: categories = [] } = useQuery({
    queryKey: ['accounting-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounting_categories')
        .select('*')
        .eq('is_active', true)
        .order('type')
        .order('name');
      if (error) throw error;
      return (data || []) as AccountingCategory[];
    },
    enabled: isAdmin === true,
  });

  /**
   * 記錄付款／退貨沖帳（取代舊 `makePaymentMutation`）。
   *
   * 舊路徑寫入**不存在的 `transactions` 表**，既不建會計分錄、也不關聯
   * `purchase_orders`，付款金額完全不會進帳戶餘額；且沒有任何單據欄位可供
   * `paidAmountMap` 回讀，等於付款紀錄是孤立的。現改為建立真正的
   * `accounting_entries` ＋ `accounting_entry_references`，與銷貨單／維修單
   * 收款共用同一套資料模型（見 `useAccounting.createEntryMutation`）。
   *
   * `references` 由 `EntryForm` 依 docItems 產生，`amount_applied` 為帶正負號的
   * 金額：一般採購為負（支出）、採購退貨為正（收入）。
   */
  const recordPaymentMutation = useMutation({
    mutationFn: async ({ orderIds, data, references }: RecordPaymentPayload) => {
      if (orderIds.length === 0) throw new Error('請先選擇要記錄付款的採購單');
      if (!data.account_id) throw new Error('請選擇付款帳戶');
      if (!data.category_id) throw new Error('請選擇會計分類');

      // ⚠️ 以下檢查必須全部「在任何寫入之前」完成。
      //
      // 這個 mutation 是 entry → references → 帳戶餘額三段寫入（非單一交易，
      // 與既有的 `useAccounting.createEntryMutation` 同一套做法）。若在
      // references 寫入前就建立 entry，一旦後段失敗就會留下一筆「有金額、
      // 卻沒掛到任何採購單」的分錄：付款金額不會被計入任何採購單的已付金額，
      // 等於錢付了但單據上查不到，且沒有任何機會自動復原。
      //
      // `orderIds` 是權威清單（畫面上被選取的採購單），`references` 則由
      // EntryForm 依 docItems 產生。使用者可在 EntryForm 中刪掉部分單據，
      // 若不檢查就會送出「金額涵蓋 N 張單、reference 只剩 M 筆」的分錄。
      const orderSet = new Set(orderIds);
      const keptRefs = (references ?? []).filter(
        (r) => r.reference_type === 'purchase_order' && orderSet.has(r.reference_id),
      );

      if (keptRefs.length !== orderIds.length) {
        const covered = new Set(keptRefs.map((r) => r.reference_id));
        const missing = orderIds.filter((id) => !covered.has(id));
        throw new Error(
          `付款分單與採購單不一致，請重新開啟付款視窗（未建立單據參考：${missing.length} 張）`,
        );
      }

      const refIds = keptRefs.map((r) => r.reference_id);
      if (new Set(refIds).size !== refIds.length) {
        throw new Error('同一張採購單出現重複的單據參考，請重新開啟付款視窗');
      }

      const zeroRefs = keptRefs.filter((r) => !Number(r.amount_applied));
      if (zeroRefs.length > 0) {
        throw new Error('有採購單的付款金額為 0，請確認後再送出');
      }

      // 支出 → 帳戶餘額減少；收入（退貨沖帳）→ 增加。
      // ⚠️ 與 `useAccounting.createEntryMutation` 同一套 signed 語意，
      // 不可改成 `-Math.abs(...)`，否則退貨沖帳會反向扣款。
      if (data.type !== 'income' && data.type !== 'expense') {
        throw new Error('付款分錄類型僅能是支出或收入');
      }
      if (!data.amount) {
        throw new Error('付款金額為 0，請確認後再送出');
      }

      // 帳戶必須在此刻就解析得到：`accounts` 來自 React Query，
      // 若 accounts query 尚未 enabled／仍在載入，原本的 `if (account)` 會靜默
      // 跳過餘額更新 —— 分錄與 references 都已建立、錢卻完全沒動，且沒有任何錯誤。
      const account = accounts.find((a: Account) => a.id === data.account_id);
      if (!account) {
        throw new Error('無法讀取付款帳戶餘額，請稍後再試');
      }
      const signedAmount = data.type === 'income' ? data.amount : -data.amount;

      const { data: newEntry, error: entryError } = await (supabase as any)
        .from('accounting_entries')
        .insert({ ...data, created_by: user?.id })
        .select('id')
        .single();
      if (entryError) throw entryError;

      {
        const { error: refError } = await (supabase as any)
          .from('accounting_entry_references')
          .insert(
            keptRefs.map((ref) => ({
              entry_id: newEntry.id,
              reference_type: ref.reference_type,
              reference_id: ref.reference_id,
              item_name: ref.item_name,
              amount_applied: ref.amount_applied,
            })),
          );
        if (refError) throw refError;
      }

      const { error: accError } = await (supabase as any)
        .from('accounts')
        .update({ balance: account.balance + signedAmount })
        .eq('id', data.account_id);
      if (accError) throw accError;

      return { entryId: newEntry.id, orderCount: orderIds.length, refCount: keptRefs.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-categories'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-paid-amounts'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success(`已記錄 ${result.orderCount} 張採購單的付款`);
    },
    onError: (e) => toast.error(getErrorMessage(e, '記錄付款失敗')),
  });

  const unlinkOrdersFromPurchaseMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, orderIds }: { purchaseOrderId: string; orderIds: string[] }) => {
      const { data, error } = await (supabase as any)
        .rpc('unlink_orders_from_purchase_order', {
          p_purchase_order_id: purchaseOrderId,
          p_order_ids: orderIds,
        });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      const removed = data?.removed_item_count ?? 0;
      const updated = data?.updated_item_count ?? 0;
      toast.success(`已解除 ${removed + updated} 筆採購連結（移除 ${removed} 筆、更新 ${updated} 筆）`);
    },
    onError: () => toast.error('解除採購連結失敗'),
  });

  return {
    suppliers,
    isLoadingSuppliers,
    orders,
    ordersLoading,
    products,
    orderItems,
    itemsLoading,
    sourceOrderMap,
    supplierMappingMap,
    accounts,
    categories,
    paidAmountMap,
    paidAmountsLoading,
    canSeePayments: isAdmin === true,
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    updateSupplierMutation,
    updateItemMutation,
    deleteItemMutation,
    reorderItemsMutation,
    importItemsMutation,
    receiveItemsMutation,
    recordPaymentMutation,
    unlinkOrdersFromPurchaseMutation,
  };
}
