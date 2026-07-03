import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Wrench, Smartphone, Phone, Calendar } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { ColumnDef } from '@tanstack/react-table';
import { formatDate } from '@/lib/formatters';
import { useRepairOrders } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, RepairOrder as RepairOrderType } from '@/types/repair';
import { useAuth } from '@/hooks/useAuth';

export default function AdminRepairOrders() {
  const navigate = useNavigate();
  const { currentStoreId } = useAuth();
  const { orders, isLoading, updateStatusMutation } = useRepairOrders();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      const matchSearch = !search
        || o.customer_name.toLowerCase().includes(search.toLowerCase())
        || o.customer_phone?.includes(search)
        || o.code?.toLowerCase().includes(search.toLowerCase())
        || o.device_imei?.includes(search);
      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [orders, search, statusFilter]);

  const columns: ColumnDef<RepairOrderType & { device_model?: any; items?: any[] }>[] = [
    {
      header: '維修單號',
      accessorKey: 'code',
      cell: ({ row }) => (
        <button
          className="text-primary font-mono text-sm hover:underline text-left"
          onClick={() => navigate(`/admin/repair-orders/${row.original.id}`)}
        >
          {row.original.code}
        </button>
      ),
    },
    {
      header: '客戶',
      accessorKey: 'customer_name',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium text-sm">{row.original.customer_name}</span>
          {row.original.customer_phone && (
            <span className="text-xs text-muted-foreground">{row.original.customer_phone}</span>
          )}
        </div>
      ),
    },
    {
      header: '裝置',
      accessorKey: 'device_model_id',
      cell: ({ row }) => {
        const model = (row.original as any).device_model;
        const specs = [row.original.device_color, row.original.device_storage].filter(Boolean).join(' / ');
        return (
          <div className="flex flex-col">
            <span className="text-sm">{model?.name || '-'}</span>
            {specs && <span className="text-xs text-muted-foreground">{specs}</span>}
          </div>
        );
      },
    },
    {
      header: 'IMEI',
      accessorKey: 'device_imei',
      cell: ({ row }) => (
        <span className="text-xs font-mono text-muted-foreground">{row.original.device_imei || '-'}</span>
      ),
    },
    {
      header: '狀態',
      accessorKey: 'status',
      cell: ({ row }) => (
        <select
          value={row.original.status}
          onChange={(e) => {
            updateStatusMutation.mutate({ id: row.original.id, status: e.target.value });
          }}
          className={`text-xs px-2 py-1 rounded-md border-0 font-medium cursor-pointer ${REPAIR_ORDER_STATUS_COLORS[row.original.status as keyof typeof REPAIR_ORDER_STATUS_COLORS] || ''}`}
        >
          {Object.entries(REPAIR_ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      ),
    },
    {
      header: '金額',
      accessorKey: 'total_price',
      cell: ({ row }) => (
        <div className="text-right">
          <div className="text-sm font-semibold">${row.original.total_price?.toLocaleString()}</div>
          {row.original.deposit > 0 && (
            <div className="text-xs text-muted-foreground">定金 ${row.original.deposit}</div>
          )}
        </div>
      ),
    },
    {
      header: '建立時間',
      accessorKey: 'created_at',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.original.created_at)}</span>
      ),
    },
  ];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders?.length || 0 };
    orders?.forEach((o) => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    return counts;
  }, [orders]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            維修管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">管理所有手機維修訂單與收據</p>
        </div>
        <Button onClick={() => navigate('/admin/repair-orders/new')}>
          <Plus className="mr-2 h-4 w-4" />
          新增維修單
        </Button>
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-muted/20 border rounded-xl">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
          <Input
            placeholder="搜尋客戶、單號、IMEI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries({ all: '全部', ...REPAIR_ORDER_STATUS_LABELS }).map(([key, label]) => (
            <Badge
              key={key}
              variant={statusFilter === key ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(key)}
            >
              {label} {statusCounts[key] !== undefined ? `(${statusCounts[key]})` : ''}
            </Badge>
          ))}
        </div>
      </div>

      <DataTable columns={columns} data={filtered} isLoading={isLoading} />
    </div>
  );
}
