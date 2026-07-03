import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Wrench } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { ColumnDef } from '@tanstack/react-table';
import { formatDate } from '@/lib/formatters';
import { useRepairOrders } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, RepairOrder as RepairOrderType } from '@/types/repair';
import { useAuth } from '@/hooks/useAuth';

export default function StoreRepairOrders() {
  const navigate = useNavigate();
  const { currentStoreId } = useAuth();
  const { orders, isLoading, updateStatusMutation } = useRepairOrders(currentStoreId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      const matchSearch = !search
        || o.customer_name.toLowerCase().includes(search.toLowerCase())
        || o.customer_phone?.includes(search)
        || o.code?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [orders, search, statusFilter]);

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
        <span className="font-mono text-sm font-semibold">${row.original.total_price?.toLocaleString()}</span>
      ),
    },
    {
      header: '日期',
      accessorKey: 'created_at',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.original.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            維修管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">管理門市維修訂單</p>
        </div>
        <Button onClick={() => navigate('/dashboard/repair-orders/new')}>
          <Plus className="mr-2 h-4 w-4" />
          新增維修單
        </Button>
      </div>

      <div className="flex flex-col md:flex-row items-start gap-4 p-4 bg-muted/20 border rounded-xl">
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
          <Input
            placeholder="搜尋..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusFilter === 'all' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setStatusFilter('all')}>
            全部
          </Badge>
          {Object.entries(REPAIR_ORDER_STATUS_LABELS).map(([key, label]) => (
            <Badge
              key={key}
              variant={statusFilter === key ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </Badge>
          ))}
        </div>
      </div>

      <DataTable columns={columns} data={filtered} isLoading={isLoading} />
    </div>
  );
}
