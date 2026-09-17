import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Truck, Undo2 } from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";
import { DragEndEvent } from "@dnd-kit/core";
import { PageHeader } from '@/components/layout/PageHeader';
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { ShippingPoolFilterBar } from "./shippingPool/ShippingPoolFilterBar";
import { ShippingPoolGroups } from "./shippingPool/ShippingPoolGroups";
import { ShipDialog } from "./shippingPool/ShipDialog";
import { ShippingPoolMobileFooters } from "./shippingPool/ShippingPoolMobileFooters";
import { usePoolStock } from "./shippingPool/usePoolStock";
import { useShippingPoolSource } from "./shippingPool/useShippingPoolSource";
import { useShippingPoolMutations } from "./shippingPool/useShippingPoolMutations";
import { GroupedByStore, PoolSortDir, PoolSortField, ShippingPoolItem } from "./shippingPool/shippingPoolTypes";

export default function AdminShippingPool() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { defaultWarehouse, warehouses } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [storeFilter, setStoreFilter] = useState<string>(searchParams.get("store") || "all");
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [selectedPoolItemIds, setSelectedPoolItemIds] = useState<Set<string>>(new Set());
  const [showShipDialog, setShowShipDialog] = useState(false);
  const [notes, setNotes] = useState("");
  const [shippedAt, setShippedAt] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [consignmentOverrideMap, setConsignmentOverrideMap] = useState<Record<string, boolean>>({});
  const [localOrder, setLocalOrder] = useState<Record<string, string[]>>({});

  const {
    warehouseMap,
    sourceMap,
    setWarehouseMap,
    setSourceMap,
    getSourceValue,
    setSourceValue,
  } = useShippingPoolSource(defaultWarehouse?.id);

  const { data: stores } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("stores") as any).select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  // 獲取出貨池項目
  const { data: shippingPoolItems, isLoading } = useQuery({
    queryKey: ["shipping-pool", storeFilter],
    queryFn: async () => {
      let query = (supabase
        .from("shipping_pool") as any)
        .select(`
          id,
          order_item_id,
          quantity,
          store_id,
          created_at,
          sort_order,
            order_item:order_items(
              id,
              order_id,
              product_id,
              variant_id,
              order:orders(code, consignment_mode),
              quantity,
              shipped_quantity,
              unit_price,
              product:products(name, code),
              product_variant:product_variants(name)
            )
        `)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ShippingPoolItem[];
    },
  });

  // 按店家分組
  const groupedByStore: GroupedByStore[] = shippingPoolItems?.reduce((acc, item) => {
    const store = stores?.find(s => s.id === item.store_id);
    const existingGroup = acc.find(g => g.storeId === item.store_id);

    if (existingGroup) {
      existingGroup.items.push(item);
      existingGroup.totalQuantity += item.quantity;
    } else {
      acc.push({
        storeId: item.store_id,
        storeName: store?.name || '未知店家',
        storeCode: store?.code || null,
        items: [item],
        totalQuantity: item.quantity,
      });
    }
    return acc;
  }, [] as GroupedByStore[]) || [];

  // 抬頭欄位排序
  const [sortField, setSortField] = useState<PoolSortField>('created_at');
  const [sortDir, setSortDir] = useState<PoolSortDir>('asc');

  const handleSort = (field: PoolSortField) => {
    // 排序列（欄位或方向）變動時清掉手動拖曳順序，讓表頭排序立即生效
    setLocalOrder({});
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const getSortValue = (item: ShippingPoolItem, field: PoolSortField): string | number => {
    switch (field) {
      case 'product':
        return (item.order_item?.product_variant?.name || item.order_item?.product?.name || '').toLowerCase();
      case 'quantity':
        return item.quantity;
      case 'unit_price':
        return item.order_item?.unit_price || 0;
      case 'subtotal':
        return item.quantity * (item.order_item?.unit_price || 0);
      case 'created_at':
        return new Date(item.created_at).getTime();
      default:
        return 0;
    }
  };

  const handleDragEnd = (storeId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const group = groupedByStore.find(g => g.storeId === storeId);
    if (!group) return;

    const oldIndex = group.items.findIndex(i => i.id === active.id);
    const newIndex = group.items.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(group.items, oldIndex, newIndex);

    setLocalOrder(prev => ({
      ...prev,
      [storeId]: reordered.map(i => i.id),
    }));

    // 持久化到資料庫
    const payload = reordered.map((item, idx) => ({
      id: item.id,
      sort_order: idx + 1,
    }));
    supabase.rpc('reorder_shipping_pool_items', { p_items: payload }).then(({ error }) => {
      if (error) console.error('reorder_shipping_pool_items failed:', error);
    });
  };

  const sortedGroups = useMemo(() => {
    return groupedByStore.map(group => {
      const sorted = [...group.items].sort((a, b) => {
        const aVal = getSortValue(a, sortField);
        const bVal = getSortValue(b, sortField);
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
      const order = localOrder[group.storeId];
      if (order && order.length === sorted.length) {
        const itemMap = new Map(sorted.map(i => [i.id, i]));
        const reordered = order.map(id => itemMap.get(id)).filter(Boolean) as ShippingPoolItem[];
        if (reordered.length === sorted.length) return { ...group, items: reordered };
      }
      return { ...group, items: sorted };
    });
  }, [groupedByStore, sortField, sortDir, localOrder]);

  // 過濾搜索結果
  const filteredGroups = sortedGroups.filter(group => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      group.storeName.toLowerCase().includes(searchLower) ||
      group.storeCode?.toLowerCase().includes(searchLower) ||
      group.items.some(item =>
        item.order_item?.product?.name.toLowerCase().includes(searchLower) ||
        (item.order_item?.product as any)?.code.toLowerCase().includes(searchLower)
      )
    );
  });

  const toggleStore = (storeId: string) => {
    const newSelected = new Set(selectedStores);
    if (newSelected.has(storeId)) {
      newSelected.delete(storeId);
    } else {
      newSelected.add(storeId);
    }
    setSelectedStores(newSelected);
  };

  // ---- 品項級選取（回滾成訂單）----
  const togglePoolItem = (poolId: string) => {
    setSelectedPoolItemIds(prev => {
      const next = new Set(prev);
      if (next.has(poolId)) next.delete(poolId);
      else next.add(poolId);
      return next;
    });
  };

  const toggleAllInGroup = (group: GroupedByStore) => {
    const allSelected = group.items.every(i => selectedPoolItemIds.has(i.id));
    setSelectedPoolItemIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        group.items.forEach(i => next.delete(i.id));
      } else {
        group.items.forEach(i => next.add(i.id));
      }
      return next;
    });
  };

  const { batchRemoveMutation, shipMutation } = useShippingPoolMutations({
    user,
    queryClient,
    selectedStores,
    sortedGroups,
    notes,
    shippedAt,
    warehouseMap,
    sourceMap,
    consignmentOverrideMap,
    setSelectedPoolItemIds,
    setSelectedStores,
    setShowShipDialog,
    setNotes,
  });

  const getSelectedSummary = () => {
    const selectedGroups = groupedByStore.filter(g => selectedStores.has(g.storeId));
    const itemCount = selectedGroups.reduce((sum, g) => sum + g.items.length, 0);
    const totalQuantity = selectedGroups.reduce((sum, g) => sum + g.totalQuantity, 0);
    return { storeCount: selectedStores.size, itemCount, totalQuantity };
  };

  const summary = getSelectedSummary();

  const ownWarehouses = warehouses.filter(w => w.include_in_available && w.is_active !== false);
  const selectedPoolItems = shippingPoolItems?.filter(i => selectedStores.has(i.store_id)) || [];
  const { data: poolStock } = usePoolStock(selectedPoolItems);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("search", value);
      else next.delete("search");
      return next;
    }, { replace: true });
  };

  const handleStoreFilterChange = (value: string) => {
    setStoreFilter(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all") next.set("store", value);
      else next.delete("store");
      return next;
    }, { replace: true });
  };

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <PageHeader
        title="出貨池"
        subtitle="將待出貨項目合併為銷售單後出貨"
        icon={<Package className="h-5 w-5" />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              待出貨項目
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={() => batchRemoveMutation.mutate(Array.from(selectedPoolItemIds))}
                disabled={selectedPoolItemIds.size === 0 || batchRemoveMutation.isPending}
                className="hidden md:flex"
              >
                <Undo2 className="h-4 w-4 mr-2" />
                回滾成訂單 ({selectedPoolItemIds.size})
              </Button>
              <Button
                onClick={() => setShowShipDialog(true)}
                disabled={selectedStores.size === 0}
                className="hidden md:flex"
              >
                <Truck className="h-4 w-4 mr-2" />
                確認出貨 ({selectedStores.size} 店家)
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShippingPoolFilterBar
            search={search}
            onSearchChange={handleSearchChange}
            storeFilter={storeFilter}
            onStoreFilterChange={handleStoreFilterChange}
            stores={stores}
          />

          <ShippingPoolGroups
            isLoading={isLoading}
            groups={filteredGroups}
            selectedStores={selectedStores}
            onToggleStore={toggleStore}
            selectedPoolItemIds={selectedPoolItemIds}
            onTogglePoolItem={togglePoolItem}
            onToggleAllInGroup={toggleAllInGroup}
            onDragEnd={handleDragEnd}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
          />
        </CardContent>
      </Card>

      <ShipDialog
        open={showShipDialog}
        onOpenChange={(open) => {
          setShowShipDialog(open);
          if (open) {
            setWarehouseMap({});
            setSourceMap({});
          }
        }}
        summary={summary}
        groups={filteredGroups}
        selectedStores={selectedStores}
        ownWarehouses={ownWarehouses}
        poolStock={poolStock}
        consignmentOverrideMap={consignmentOverrideMap}
        onConsignmentOverrideChange={(orderItemId, v) => setConsignmentOverrideMap(prev => ({ ...prev, [orderItemId]: v }))}
        getSourceValue={getSourceValue}
        onSourceValueChange={setSourceValue}
        shippedAt={shippedAt}
        onShippedAtChange={setShippedAt}
        notes={notes}
        onNotesChange={setNotes}
        isPending={shipMutation.isPending}
        onConfirm={() => shipMutation.mutate()}
      />

      <ShippingPoolMobileFooters
        rollbackCount={selectedPoolItemIds.size}
        isRollbackPending={batchRemoveMutation.isPending}
        onRollback={() => batchRemoveMutation.mutate(Array.from(selectedPoolItemIds))}
        storeCount={summary.storeCount}
        totalQuantity={summary.totalQuantity}
        isShipPending={shipMutation.isPending}
        onOpenShipDialog={() => setShowShipDialog(true)}
      />
    </div>
  );
}