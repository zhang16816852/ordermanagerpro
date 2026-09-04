import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProductCache } from '@/hooks/useProductCache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, UserCog, Store as StoreIcon, Percent, Check, X, Pencil, Save, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { formatCurrency } from '@/lib/formatters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type RepRecord = {
  user_id: string;
  role: string;
  commission_rate: number | null;
};

type ProfileRecord = {
  id: string;
  email: string;
  full_name: string | null;
};

export default function AdminReps() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'reps');
  const [repSearch, setRepSearch] = useState('');

  // --- 業務列表 / 佣金編輯 ---
  const [editingRep, setEditingRep] = useState<{ userId: string; commission: string } | null>(null);
  const [showCommissionDialog, setShowCommissionDialog] = useState(false);

  // --- 店家分配 ---
  const [repoRepId, setRepoRepId] = useState<string>('');
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
  const { data: stores = [] } = useQuery<{ id: string; name: string; code: string | null }[]>({
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

  const filteredCostProducts = useMemo(() => {
    const q = costSearch.toLowerCase();
    return allProducts.filter(p =>
      p.name.toLowerCase().includes(q) || (p.code && p.code.toLowerCase().includes(q))
    );
  }, [allProducts, costSearch]);

  // 業務成本（目前所選業務，成本設定 tab 用）
  const { data: repCosts = [] } = useQuery<{ rep_id: string; product_id: string; variant_id: string | null; cost: number }[]>({
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
  const { data: allRepCosts = [] } = useQuery<{ rep_id: string; product_id: string; variant_id: string | null; cost: number }[]>({
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

  // 業務名下訂單（應發分潤彙總用）
  const { data: repOrders = [] } = useQuery<{
    sales_rep_id: string;
    status: string;
    order_items: { product_id: string; variant_id: string | null; unit_price: number; quantity: number }[];
  }[]>({
    queryKey: ['admin-rep-orders', repIds.join(',')],
    queryFn: async () => {
      if (repIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('orders') as any)
        .select('sales_rep_id, status, order_items(product_id, variant_id, unit_price, quantity)')
        .in('sales_rep_id', repIds)
        .not('status', 'eq', 'cancelled');
      if (error) throw error;
      return data || [];
    },
    enabled: repIds.length > 0,
  });

  // 應發分潤彙總（每業務：已出貨/已收款訂單的佣金加總）
  const repCommissionSummary = useMemo(() => {
    const map: Record<string, { totalCommission: number; orderCount: number }> = {};
    // 每次價值建立 cost lookup
    const costLookup = new Map<string, number>();
    for (const row of allRepCosts) {
      costLookup.set(`${row.rep_id}|${row.product_id}|${row.variant_id ?? 'null'}`, Number(row.cost) || 0);
    }
    const getCost = (repId: string, productId: string, variantId: string | null) => {
      const exact = costLookup.get(`${repId}|${productId}|${variantId ?? 'null'}`);
      if (exact !== undefined) return exact;
      return costLookup.get(`${repId}|${productId}|null`) ?? 0;
    };
    for (const o of repOrders) {
      const rate = (Number(reps.find(r => r.user_id === o.sales_rep_id)?.commission_rate) || 0) / 100;
      const entry = map[o.sales_rep_id] || (map[o.sales_rep_id] = { totalCommission: 0, orderCount: 0 });
      let orderCommission = 0;
      for (const item of o.order_items || []) {
        const cost = getCost(o.sales_rep_id, item.product_id, item.variant_id ?? null);
        const unitProfit = (Number(item.unit_price) || 0) - cost;
        const line = unitProfit * (Number(item.quantity) || 0);
        orderCommission += Math.max(0, line) * rate;
      }
      entry.totalCommission += orderCommission;
      entry.orderCount += 1;
    }
    return map;
  }, [repOrders, allRepCosts, reps]);

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
        .insert({ rep_id: repId, store_id: storeId });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast.success('已分配店家給業務');
      setGrantStoreIds(prev => ({ ...prev, [variables.repId]: [...(prev[variables.repId] || []), variables.storeId] }));
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

  // 更新成本（支援產品層級或變體層級）
  const costMutation = useMutation({
    mutationFn: async ({ repId, productId, cost, variantId }: { repId: string; productId: string; cost: number; variantId?: string | null }) => {
      const { error } = await (supabase
        .from('rep_product_costs') as any)
        .upsert(
          { rep_id: repId, product_id: productId, variant_id: variantId ?? null, cost },
          { onConflict: 'rep_id,product_id,variant_id' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('成本已儲存');
      queryClient.invalidateQueries({ queryKey: ['admin-rep-costs'] });
      queryClient.invalidateQueries({ queryKey: ['admin-rep-costs-all'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const deleteCostMutation = useMutation({
    mutationFn: async ({ repId, productId, variantId }: { repId: string; productId: string; variantId?: string | null }) => {
      const { error: delErr } = await (supabase
        .from('rep_product_costs') as any)
        .delete()
        .eq('rep_id', repId)
        .eq('product_id', productId)
        .eq('variant_id', variantId ?? null);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      toast.success('成本已移除');
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

  const openCommission = (r: RepRecord) => {
    setEditingRep({ userId: r.user_id, commission: String(r.commission_rate ?? 0) });
    setShowCommissionDialog(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">業務管理</h1>
          <p className="text-muted-foreground">管理業務身分、店家分配與成本/佣金設定</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v);
        setSearchParams({ tab: v }, { replace: true });
      }}>
        <TabsList>
          <TabsTrigger value="reps" className="gap-1.5"><UserCog className="h-4 w-4" />業務列表</TabsTrigger>
          <TabsTrigger value="assign" className="gap-1.5"><StoreIcon className="h-4 w-4" />店家分配</TabsTrigger>
          <TabsTrigger value="costs" className="gap-1.5"><Percent className="h-4 w-4" />成本設定</TabsTrigger>
        </TabsList>

        {/* Tab 1: 業務列表 + 佣金 */}
        <TabsContent value="reps" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>業務帳號</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜尋姓名 / Email"
                  className="pl-10"
                  value={repSearch}
                  onChange={(e) => setRepSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>佣金比例</TableHead>
                    <TableHead>名下店家數</TableHead>
                    <TableHead className="text-right">應發分潤</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repsLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">載入中…</TableCell></TableRow>
                  ) : filteredReps.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">尚無業務帳號</TableCell></TableRow>
                  ) : (
                    filteredReps.map((r) => {
                      const p = profileOf(r.user_id);
                      const summary = repCommissionSummary[r.user_id];
                      return (
                        <TableRow key={r.user_id}>
                          <TableCell className="font-medium">{p?.full_name || '—'}</TableCell>
                          <TableCell>{p?.email || r.user_id}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{r.commission_rate ?? 0}%</Badge>
                          </TableCell>
                          <TableCell>{assignmentStores(r.user_id).length} 家</TableCell>
                          <TableCell className="text-right">
                            {summary ? (
                              <div>
                                <div className="font-medium">{formatCurrency(summary.totalCommission)}</div>
                                <div className="text-xs text-muted-foreground">{summary.orderCount} 單</div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => openCommission(r)}>
                              <Pencil className="mr-2 h-4 w-4" />設定佣金
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">
                提示：業務身分需先在「店鋪管理 → 人員管理」將使用者設定為業務（system_role = rep），再於本站分配店家與佣金。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: 店家分配 */}
        <TabsContent value="assign" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {reps.map((r) => {
              const p = profileOf(r.user_id);
              const assigned = assignmentStores(r.user_id);
              return (
                <Card key={r.user_id}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {p?.full_name || '業務'} <span className="text-muted-foreground font-normal text-sm">({p?.email})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {assigned.length === 0 ? (
                      <p className="text-sm text-muted-foreground">尚未分配任何店家</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {assigned.map((s) => (
                          <Badge key={s.id} variant="secondary" className="gap-1">
                            {s.name}
                            <button
                              onClick={() => revokeMutation.mutate({ repId: r.user_id, storeId: s.id })}
                              className="ml-1 text-muted-foreground hover:text-destructive"
                              aria-label="解除分配"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-end gap-2 pt-2 border-t border-border">
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-xs">新增店家</Label>
                        <Select
                          value={grantStoreIds[r.user_id]?.[0] || ''}
                          onValueChange={(v) => {
                            setGrantStoreIds(prev => ({ ...prev, [r.user_id]: [...(prev[r.user_id] || []), v] }));
                            grantMutation.mutate({ repId: r.user_id, storeId: v });
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="選擇店家" />
                          </SelectTrigger>
                          <SelectContent>
                            {stores.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={!(grantStoreIds[r.user_id]?.length) || grantMutation.isPending}
                        onClick={() => {
                          const storeId = grantStoreIds[r.user_id]?.[0];
                          if (storeId) grantMutation.mutate({ repId: r.user_id, storeId });
                        }}
                      >
                        <Check className="mr-1 h-4 w-4" />分配
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {reps.length === 0 && (
            <p className="text-muted-foreground text-center py-8">尚無業務帳號</p>
          )}
        </TabsContent>

        {/* Tab 3: 成本設定 */}
        <TabsContent value="costs" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle>業務進貨成本</CardTitle>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={costRepId} onValueChange={(v) => { setCostRepId(v); setCostDrafts({}); }}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="選擇業務" />
                  </SelectTrigger>
                  <SelectContent>
                    {reps.map((r) => {
                      const p = profileOf(r.user_id);
                      return (
                        <SelectItem key={r.user_id} value={r.user_id}>{p?.full_name || p?.email || r.user_id}</SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <div className="relative w-56">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="搜尋產品"
                    className="pl-10"
                    value={costSearch}
                    onChange={(e) => setCostSearch(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!costRepId ? (
                <p className="text-muted-foreground text-center py-8">請先選擇業務</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-muted-foreground">
                      共 {filteredCostProducts.length} 個產品
                    </p>
                    <Button
                      size="sm"
                      disabled={costMutation.isPending}
                      onClick={async () => {
                        const dirtyEntries = Object.entries(costDrafts).filter(([k, v]) => {
                          const costRow = repCosts.find(c => {
                            if (k.includes(':')) {
                              const [, vid] = k.split(':');
                              return c.product_id === k.split(':')[0] && c.variant_id === vid;
                            }
                            return c.product_id === k && c.variant_id === null;
                          });
                          const saved = costRow ? String(costRow.cost) : '';
                          return v !== saved;
                        });
                        if (dirtyEntries.length === 0) { toast.info('無變更'); return; }
                        for (const [key, val] of dirtyEntries) {
                          const num = Number(val);
                          if (val === '' || Number.isNaN(num) || num < 0) continue;
                          if (key.includes(':')) {
                            const [pid, vid] = key.split(':');
                            await costMutation.mutateAsync({ repId: costRepId, productId: pid, cost: num, variantId: vid });
                          } else {
                            await costMutation.mutateAsync({ repId: costRepId, productId: key, cost: num });
                          }
                        }
                        toast.success(`已儲存 ${dirtyEntries.length} 筆成本`);
                        setCostDrafts({});
                      }}
                    >
                      <Save className="mr-1 h-4 w-4" />
                      全部儲存
                    </Button>
                  </div>
                  <div className="max-h-[600px] overflow-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>產品 / 變體</TableHead>
                          <TableHead className="w-48">業務成本</TableHead>
                          <TableHead className="w-24 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCostProducts.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">無產品</TableCell></TableRow>
                        ) : (
                          filteredCostProducts.map((p) => {
                            const variants = p.variants || [];
                            const hasVariants = variants.length > 0;
                            const isExpanded = expandedCostProducts.has(p.id);
                            const costKey = p.id;
                            const costRow = repCosts.find(c => c.product_id === p.id && c.variant_id === null);
                            const draft = costDrafts[costKey] ?? (costRow ? String(costRow.cost) : '');
                            const dirty = draft !== (costRow ? String(costRow.cost) : '');
                            const totalVariantCost = variants.reduce((sum, v) => {
                              const vr = repCosts.find(c => c.product_id === p.id && c.variant_id === v.id);
                              return sum + (vr ? Number(vr.cost) || 0 : 0);
                            }, 0);

                            return (
                              <>
                                <TableRow
                                  key={`product-${p.id}`}
                                  className={hasVariants ? 'cursor-pointer hover:bg-muted/50' : ''}
                                  onClick={() => {
                                    if (hasVariants) {
                                      setExpandedCostProducts(prev => {
                                        const next = new Set(prev);
                                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                        return next;
                                      });
                                    }
                                  }}
                                >
                                  <TableCell className="w-8">
                                    {hasVariants ? (
                                      isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <span className="inline-block w-4" />
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="font-medium">{p.name}</div>
                                    {p.code && <div className="text-xs text-muted-foreground">{p.code}</div>}
                                    {hasVariants && (
                                      <div className="text-xs text-muted-foreground mt-0.5">
                                        {variants.length} 個變體
                                        {totalVariantCost > 0 && <span className="ml-1">（合計 ${totalVariantCost.toLocaleString()}）</span>}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell onClick={(e) => e.stopPropagation()}>
                                    {hasVariants ? (
                                      <Input
                                        type="number"
                                        min={0}
                                        placeholder="統一設定"
                                        value={draft}
                                        onChange={(e) => setCostDrafts(prev => ({ ...prev, [costKey]: e.target.value }))}
                                        className="h-8"
                                      />
                                    ) : (
                                      <Input
                                        type="number"
                                        min={0}
                                        placeholder="未設定"
                                        value={draft}
                                        onChange={(e) => setCostDrafts(prev => ({ ...prev, [costKey]: e.target.value }))}
                                        className="h-8"
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      disabled={!dirty || costMutation.isPending}
                                      onClick={async () => {
                                        const num = Number(draft);
                                        if (draft === '') {
                                          await deleteCostMutation.mutateAsync({ repId: costRepId, productId: p.id });
                                          setCostDrafts(prev => ({ ...prev, [costKey]: '' }));
                                        } else if (!Number.isNaN(num) && num >= 0) {
                                          await costMutation.mutateAsync({ repId: costRepId, productId: p.id, cost: num });
                                        }
                                      }}
                                    >
                                      {costMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                                      儲存
                                    </Button>
                                  </TableCell>
                                </TableRow>
                                {hasVariants && isExpanded && variants.map((v) => {
                                  const vKey = `${p.id}:${v.id}`;
                                  const vCostRow = repCosts.find(c => c.product_id === p.id && c.variant_id === v.id);
                                  const vDraft = costDrafts[vKey] ?? (vCostRow ? String(vCostRow.cost) : '');
                                  const vDirty = vDraft !== (vCostRow ? String(vCostRow.cost) : '');
                                  return (
                                    <TableRow key={`variant-${v.id}`} className="bg-muted/20">
                                      <TableCell />
                                      <TableCell>
                                        <div className="pl-6 text-sm">
                                          {v.name || v.sku || `變體`}
                                          {v.sku && v.name && <span className="text-muted-foreground ml-1">({v.sku})</span>}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          type="number"
                                          min={0}
                                          placeholder="未設定"
                                          value={vDraft}
                                          onChange={(e) => setCostDrafts(prev => ({ ...prev, [vKey]: e.target.value }))}
                                          className="h-8"
                                        />
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-8"
                                          disabled={!vDirty || costMutation.isPending}
                                          onClick={async () => {
                                            const num = Number(vDraft);
                                            if (vDraft === '') {
                                              await deleteCostMutation.mutateAsync({ repId: costRepId, productId: p.id, variantId: v.id });
                                              setCostDrafts(prev => ({ ...prev, [vKey]: '' }));
                                            } else if (!Number.isNaN(num) && num >= 0) {
                                              await costMutation.mutateAsync({ repId: costRepId, productId: p.id, cost: num, variantId: v.id });
                                            }
                                          }}
                                        >
                                          {costMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                                          儲存
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 佣金編輯 Dialog */}
      <Dialog open={showCommissionDialog} onOpenChange={setShowCommissionDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>設定佣金比例</DialogTitle>
            <DialogDescription>佣金 = (售價 - 業務成本) × 比例</DialogDescription>
          </DialogHeader>
          {editingRep && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>佣金比例（%）</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={editingRep.commission}
                  onChange={(e) => setEditingRep(prev => prev ? { ...prev, commission: e.target.value } : prev)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommissionDialog(false)}>取消</Button>
            <Button
              disabled={commissionMutation.isPending}
              onClick={() => {
                if (!editingRep) return;
                const num = Number(editingRep.commission);
                if (Number.isNaN(num) || num < 0 || num > 100) {
                  toast.error('請輸入 0-100 的數字');
                  return;
                }
                commissionMutation.mutate({ userId: editingRep.userId, commission: num });
              }}
            >
              {commissionMutation.isPending ? '儲存中…' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
