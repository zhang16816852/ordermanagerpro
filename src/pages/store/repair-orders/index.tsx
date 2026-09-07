import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Wrench } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { ColumnDef } from '@tanstack/react-table';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { useRepairOrders, useRepairAssigneeMap } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, isRepairOrderWorking, isRepairOrderClosed, RepairOrder as RepairOrderType } from '@/types/repair';
import { useAuth } from '@/hooks/useAuth';

type RepairTab = 'all' | 'pending' | 'working' | 'closed';

const TABS: { value: RepairTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待接案' },
  { value: 'working', label: '維修中' },
  { value: 'closed', label: '已完工' },
];

export default function StoreRepairOrders() {
  const navigate = useNavigate();
  const { storeId } = useAuth();
  const { orders, isLoading, deliverMutation } = useRepairOrders(storeId || undefined);
  const assignees = useRepairAssigneeMap();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<RepairTab>('all');

  const filtered = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      const matchSearch = !search
        || o.customer_name.toLowerCase().includes(search.toLowerCase())
        || o.customer_phone?.includes(search)
        || o.code?.toLowerCase().includes(search.toLowerCase());
      const matchTab = tab === 'all'
        || (tab === 'pending' && o.status === 'pending')
        || (tab === 'working' && isRepairOrderWorking(o.status))
        || (tab === 'closed' && isRepairOrderClosed(o.status));
      return matchSearch && matchTab;
    });
  }, [orders, search, tab]);

  const tabCounts = useMemo(() => {
    const counts: Record<RepairTab, number> = { all: orders?.length || 0, pending: 0, working: 0, closed: 0 };
    orders?.forEach((o) => {
      if (o.status === 'pending') counts.pending += 1;
      if (isRepairOrderWorking(o.status)) counts.working += 1;
      if (isRepairOrderClosed(o.status)) counts.closed += 1;
    });
    return counts;
  }, [orders]);

  const columns: ColumnDef<RepairOrderType & { device_model?: any }>[] = [
    {
      header: '單號',
      accessorKey: 'code',
      cell: ({ row }) => (
        <button
          className="text-primary font-mono text-sm hover:underline text-left"
          onClick={() => navigate(`/dashboard/repair-orders/${row.original.id}`)}
        >
          {row.original.code}
        </button>
      ),
    },
    {
      header: '客戶',
      accessorKey: 'customer_name',
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-sm">{row.original.customer_name}</span>
          {row.original.customer_phone && (
            <span className="text-xs text-muted-foreground ml-2">{row.original.customer_phone}</span>
          )}
        </div>
      ),
    },
    {
      header: '裝置',
      cell: ({ row }) => (
        <span className="text-sm">{(row.original as any).device_model?.name || '-'}</span>
      ),
    },
    {
      header: '接案人',
      cell: ({ row }) => {
        const tech = row.original.assigned_to ? assignees[row.original.assigned_to] : undefined;
        return tech?.email ? (
          <span className="text-sm">{tech.email}</span>
        ) : (
          <Badge variant="outline" className="text-[10px]">開放待接案</Badge>
        );
      },
    },
    {
      header: '狀態',
      cell: ({ row }) => (
        <Badge className={REPAIR_ORDER_STATUS_COLORS[row.original.status as keyof typeof REPAIR_ORDER_STATUS_COLORS]}>
          {REPAIR_ORDER_STATUS_LABELS[row.original.status as keyof typeof REPAIR_ORDER_STATUS_LABELS]}
        </Badge>
      ),
    },
    {
      header: '金額',
      accessorKey: 'total_price',
      cell: ({ row }) => (
        <span className="font-mono text-sm font-semibold">{formatCurrency(row.original.total_price ?? 0)}</span>
      ),
    },
    {
      header: '日期',
      accessorKey: 'created_at',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.original.created_at)}</span>
      ),
    },
    {
      header: '操作',
      id: 'actions',
      cell: ({ row }) => {
        if (row.original.status !== 'ready') return null;
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              deliverMutation.mutate(row.original.id);
            }}
          >
            交還客戶
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" aria-hidden="true" />
            門市維修
          </h1>
          <p className="text-muted-foreground text-sm mt-1">收件、發布給接案人、追蹤並交還客戶</p>
        </div>
        <Button onClick={() => navigate('/dashboard/repair-orders/new')}>
          <Plus className="mr-2 h-4 w-4" />
          收件建單
        </Button>
      </div>

      <div className="flex flex-col md:flex-row items-start gap-4 p-4 bg-muted/20 border rounded-xl">
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" aria-hidden="true" />
          <Input
            placeholder="搜尋..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Badge
              key={t.value}
              variant={tab === t.value ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setTab(t.value)}
            >
              {t.label} ({tabCounts[t.value]})
            </Badge>
          ))}
        </div>
      </div>

      <DataTable columns={columns} data={filtered} isLoading={isLoading} />
    </div>
  );
}