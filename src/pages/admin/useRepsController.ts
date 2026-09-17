import { useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProductCache } from '@/hooks/useProductCache';
import { useVariantWholesale } from '@/hooks/useVariantWholesale';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import type {
  RepRecord,
  ProfileRecord,
  RepSummary,
  AssignableStore,
  CostRow,
  CostItemInput,
} from './repsTypes';

interface RepSalesNoteItem {
  quantity: number;
  order_item: { product_id: string; variant_id: string | null; unit_price: number } | null;
}

interface RepSalesNote {
  id: string;
  code: string | null;
  store_id: string;
  status: string;
  payment_status: string;
  shipped_at: string | null;
  sales_note_items: RepSalesNoteItem[];
}

export function useRepsController() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'reps');
  const [repSearch, setRepSearch] = useState('');
  const [assignSearch, setAssignSearch] = useState('');

  // --- 業務列表 / 佣金編輯 ---
  const [editingRep, setEditingRep] = useState<{ userId: string; commission: string } | null>(null);
  const [showCommissionDialog, setShowCommissionDialog] = useState(false);

  // --- 店家分配 ---
  const [grantStoreIds, setGrantStoreIds] = useState<Record<string, string[]>>({});

  // --- 成本設定 ---
  const [costRepId, setCostRepId] = useState<string>('');
  const [costSearch, setCostSearch] = useState('');
  const [expandedCostProducts, setExpandedCostProducts] = useState<Set<string>>(new Set());
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});

  // ==================== QUERIES ====================

  // 所有業務（user_roles role='rep'）
  const { data: reps = [], isLoading: repsLoading } = useQuery<RepRecord[]>({
    queryKey: ['admin-reps'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('user_roles') as any)
        .select('user_id, role, commission_rate')
        .eq('role', 'rep');
      if (error) throw error;
      return data || [];
    },
  });

  const repIds = useMemo(() => reps.map(r => r.user_id), [reps]);

  // 業務的個人資料（email / full_name）
  const { data: repProfiles = [] } = useQuery<ProfileRecord[]>({
    queryKey: ['admin-rep-profiles', repIds.join(',')],
    queryFn: async () => {
      if (repIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('profiles') as any)
        .select('id, email, full_name')
        .in('id', repIds);
      if (error) throw error;
      return data || [];
    },
    enabled: repIds.length > 0,
  });

  // 店家清單
  const { data: stores = [] } = useQuery<AssignableStore[]>({
    queryKey: ['admin-reps-stores'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('stores') as any)
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const storeIds = useMemo(() => stores.map(s => s.id), [stores]);

  // 業務 ↔ 店家分配（由 admin 可看全量）
  const { data: repAssignments = [] } = useQuery<{ rep_id: string; store_id: string }[]>({
    queryKey: ['admin-rep-assignments'],
    queryFn: async () => {
      if (storeIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('rep_store_assignments') as any)
        .select('rep_id, store_id')
        .in('store_id', storeIds);
      if (error) throw error;
      return data || [];
    },
    enabled: storeIds.length > 0,
  });

  // 產品清單（成本設定用，含變體）
  const { products: allProducts, isLoading: productsLoading } = useProductCache();

  // 進貨成本（變體批發價）fallback
  const { wholesaleMap } = useVariantWholesale();

  const filteredCostProducts = useMemo(() => {
    const q = costSearch.toLowerCase();
    return allProducts.filter(p =>
      p.name.toLowerCase().includes(q) || (p.code && p.code.toLowerCase().includes(q))
    );
  }, [allProducts, costSearch]);

  // 業務成本（目前所選業務，成本設定 tab 用）
  const { data: repCosts = [] } = useQuery<CostRow[]>({
    queryKey: ['admin-rep-costs', costRepId],
    queryFn: async () => {
      if (!costRepId) return [];
      const { data, error } = await (supabase
        .from('rep_product_costs') as any)
        .select('rep_id, product_id, variant_id, cost')
        .eq('rep_id', costRepId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!costRepId,
  });

  // 全體業務成本（應發分潤彙總用）
  const { data: allRepCosts = [] } = useQuery<CostRow[]>({
    queryKey: ['admin-rep-costs-all', repIds.join(',')],
    queryFn: async () => {
      if (repIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('rep_product_costs') as any)
        .select('rep_id, product_id, variant_id, cost')
        .in('rep_id', repIds);
      if (error) throw error;
      return data || [];
    },
    enabled: repIds.length > 0,
  });

  // 業務名下銷貨單（依店家分配自動歸屬）
  const allAssignedStoreIds = useMemo(() => {
    return [...new Set(repAssignments.map(a => a.store_id))];
  }, [repAssignments]);

  // store_id → rep_ids[] 對應表
  const storeToReps = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of repAssignments) {
      const list = map.get(a.store_id) || [];
      list.push(a.rep_id);
      map.set(a.store_id, list);
    }
    return map;
  }, [repAssignments]);

  const { data: repSalesNotes = [] } = useQuery<RepSalesNote[]>({
    queryKey: ['admin-rep-sales-notes', allAssignedStoreIds.join(',')],
    queryFn: async () => {
      if (allAssignedStoreIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('sales_notes') as any)
        .select(`
          id, code, store_id, status, payment_status, shipped_at,
          sales_note_items(
            quantity,
            order_item:order_items(product_id, variant_id, unit_price)
          )
        `)
        .in('store_id', allAssignedStoreIds)
        .in('status', ['shipped', 'received'])
        .order('sort_order', { foreignTable: 'sales_note_items', ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: allAssignedStoreIds.length > 0,
  });

  // 應發分潤彙總（每業務：依店家分配歸屬的銷貨單佣金加總）
  const repCommissionSummary = useMemo<RepSummary>(() => {
    const map: RepSummary = {};
    const costLookup = new Map<string, number>();
    for (const row of allRepCosts) {
      costLookup.set(`${row.rep_id}|${row.product_id}|${row.variant_id ?? 'null'}`, Number(row.cost) || 0);
    }
    const getCost = (repId: string, productId: string, variantId: string | null) => {
      const exact = costLookup.get(`${repId}|${productId}|${variantId ?? 'null'}`);
      if (exact !== undefined) return exact;
      const productLevel = costLookup.get(`${repId}|${productId}|null`);
      if (productLevel !== undefined) return productLevel;
      return wholesaleMap.get(`${productId}|${variantId ?? ''}`) ?? 0;
    };
    for (const sn of repSalesNotes) {
      const assignedReps = storeToReps.get(sn.store_id) || [];
      for (const repId of assignedReps) {
        const rate = (Number(reps.find(r => r.user_id === repId)?.commission_rate) || 0) / 100;
        if (rate === 0) continue;
        const entry = map[repId] || (map[repId] = { totalCommission: 0, totalProfit: 0, noteCount: 0, totalSales: 0 });
        let noteCommission = 0;
        let noteProfit = 0;
        let noteSales = 0;
        for (const item of sn.sales_note_items || []) {
          const oi = item.order_item;
          if (!oi) continue;
          const cost = getCost(repId, oi.product_id, oi.variant_id ?? null);
          const unitProfit = (Number(oi.unit_price) || 0) - cost;
          const line = unitProfit * (Number(item.quantity) || 0);
          noteProfit += line;
          noteSales += (Number(oi.unit_price) || 0) * (Number(item.quantity) || 0);
          noteCommission += Math.max(0, line) * rate;
        }
        entry.totalCommission += noteCommission;
        entry.totalProfit += noteProfit;
        entry.totalSales += noteSales;
        entry.noteCount += 1;
      }
    }
    return map;
  }, [repSalesNotes, allRepCosts, reps, storeToReps, wholesaleMap]);

  // ==================== MUTATIONS ====================

  // 更新佣金比例
  const commissionMutation = useMutation({
    mutationFn: async ({ userId, commission }: { userId: string; commission: number }) => {
      const { error } = await (supabase
        .from('user_roles') as any)
        .update({ commission_rate: commission })
        .eq('user_id', userId)
        .eq('role', 'rep');
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('佣金比例已更新');
      setShowCommissionDialog(false);
      queryClient.invalidateQueries({ queryKey: ['admin-reps'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // 分配店家
  const grantMutation = useMutation({
    mutationFn: async ({ repId, storeId }: { repId: string; storeId: string }) => {
      const { error } = await (supabase
        .from('rep_store_assignments') as any)
        .upsert(
          { rep_id: repId, store_id: storeId },
          { onConflict: 'rep_id,store_id', ignoreDuplicates: true }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-rep-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-reps-stores'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // 解除分配
  const revokeMutation = useMutation({
    mutationFn: async ({ repId, storeId }: { repId: string; storeId: string }) => {
      const { error } = await (supabase
        .from('rep_store_assignments') as any)
        .delete()
        .eq('rep_id', repId)
        .eq('store_id', storeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已解除店家分配');
      queryClient.invalidateQueries({ queryKey: ['admin-rep-assignments'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // 批次更新成本（一次送出全部 upsert + delete，單一 RPC）
  const batchCostMutation = useMutation({
    mutationFn: async ({ repId, items }: { repId: string; items: CostItemInput[] }) => {
      const { data, error } = await (supabase as any).rpc('upsert_rep_product_costs', {
        p_rep_id: repId,
        p_items: items,
      });
      if (error) throw error;
      return data as { upserted: number; deleted: number };
    },
    onSuccess: (data) => {
      toast.success(`已儲存 ${data.upserted} 筆、移除 ${data.deleted} 筆成本`);
      setCostDrafts({});
      queryClient.invalidateQueries({ queryKey: ['admin-rep-costs'] });
      queryClient.invalidateQueries({ queryKey: ['admin-rep-costs-all'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // ==================== 本地編輯狀態 ====================

  const profileOf = (userId: string) => repProfiles.find(p => p.id === userId);
  const assignmentStores = (repId: string) => {
    const assigned = new Set(
      repAssignments.filter(a => a.rep_id === repId).map(a => a.store_id)
    );
    return stores.filter(s => assigned.has(s.id));
  };

  const filteredReps = reps.filter(r => {
    const p = profileOf(r.user_id);
    const q = repSearch.toLowerCase();
    if (!q) return true;
    return (p?.email || '').toLowerCase().includes(q)
      || (p?.full_name || '').toLowerCase().includes(q)
      || (p?.email || '').toLowerCase().includes(q);
  });

  const filteredAssignReps = reps.filter(r => {
    const p = profileOf(r.user_id);
    const q = assignSearch.toLowerCase();
    if (!q) return true;
    return (p?.email || '').toLowerCase().includes(q)
      || (p?.full_name || '').toLowerCase().includes(q);
  });

  const openCommission = (r: RepRecord) => {
    setEditingRep({ userId: r.user_id, commission: String(r.commission_rate ?? 0) });
    setShowCommissionDialog(true);
  };

  return {
    navigate,
    activeTab,
    setActiveTab,
    setSearchParams,
    reps,
    repsLoading,
    repProfiles,
    stores,
    repAssignments,
    allProducts,
    productsLoading,
    repCosts,
    repCommissionSummary,
    repIds,
    storeIds,
    allAssignedStoreIds,
    storeToReps,
    repSalesNotes,
    repSearch,
    setRepSearch,
    assignSearch,
    setAssignSearch,
    editingRep,
    setEditingRep,
    showCommissionDialog,
    setShowCommissionDialog,
    grantStoreIds,
    setGrantStoreIds,
    costRepId,
    setCostRepId,
    costSearch,
    setCostSearch,
    expandedCostProducts,
    setExpandedCostProducts,
    costDrafts,
    setCostDrafts,
    filteredCostProducts,
    filteredReps,
    filteredAssignReps,
    profileOf,
    assignmentStores,
    commissionMutation,
    grantMutation,
    revokeMutation,
    batchCostMutation,
    openCommission,
  };
}