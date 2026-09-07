import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Wrench } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { ColumnDef } from '@tanstack/react-table';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { useRepairOrders, useRepairAssigneeMap } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, isRepairOrderAcceptable, isRepairOrderWorking, isRepairOrderClosed, RepairOrder as RepairOrderType } from '@/types/repair';
import { useAuth } from '@/hooks/useAuth';
import { useRepairBase } from '@/lib/repairBase';

type WorkbenchTab = 'pending' | 'mine' | 'all' | 'closed';

const TABS: { value: WorkbenchTab; label: string }[] = [
  { value: 'pending', label: '待接案' },
  { value: 'mine', label: '我處理中' },
  { value: 'all', label: '全部' },
  { value: 'closed', label: '已完成' },
];

export default function AdminRepairOrders() {
  const navigate = useNavigate();
  const repairBase = useRepairBase();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orders, isLoading, updateStatusMutation, acceptAndStartMutation } = useRepairOrders();
  const assignees = useRepairAssigneeMap();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [tab, setTab] = useState<WorkbenchTab>((searchParams.get('tab') as WorkbenchTab) || 'pending');

  const userId = user?.id;

  const filtered = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      const matchSearch = !search
        || o.customer_name.toLowerCase().includes(search.toLowerCase())
        || o.customer_phone?.includes(search)
        || o.code?.toLowerCase().includes(search.toLowerCase())
        || o.device_imei?.includes(search);
      let matchTab = true;
      if (tab === 'pending') {
        matchTab = isRepairOrderAcceptable(o.status) && (!o.assigned_to || o.assigned_to === userId);
      } else if (tab === 'mine') {
        matchTab = o.assigned_to === userId && (isRepairOrderWorking(o.status) || isRepairOrderAcceptable(o.status));
      } else if (tab === 'closed') {
        matchTab = isRepairOrderClosed(o.status);
      }
      return matchSearch && matchTab;
    });
  }, [orders, search, tab, userId]);

  const tabCounts = useMemo(() => {
    const counts: Record<WorkbenchTab, number> = { pending: 0, mine: 0, all: orders?.length || 0, closed: 0 };
    orders?.forEach((o) => {
      if (isRepairOrderAcceptable(o.status) && (!o.assigned_to || o.assigned_to === userId)) counts.pending += 1;
      if (o.assigned_to === userId && (isRepairOrderWorking(o.status) || isRepairOrderAcceptable(o.status))) counts.mine += 1;
      if (isRepairOrderClosed(o.status)) counts.closed += 1;
    });
    return counts;
  }, [orders, userId]);

  const setTabWithParams = (value: WorkbenchTab) => {
    setTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value !== 'all') next.set('tab', value);
      else next.delete('tab');
      return next;
    }, { replace: true });
  };

  const columns: ColumnDef<RepairOrderType & { device_model?: any; store?: any }>[] = [
    {
      header: '維修單號',
      accessorKey: 'code',
      cell: ({ row }) => (
        <button
          className="text-primary font-mono text-sm hover:underline text-left"
          onClick={() => navigate(`${repairBase}/${row.original.id}`)}
        >
          {row.original.code}
        </button>
      ),
    },
    {
      header: '店家',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.store?.name || '-'}</span>
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
          <div className="text-sm font-semibold">{formatCurrency(row.original.total_price || 0)}</div>
          {row.original.deposit > 0 && (
            <div className="text-xs text-muted-foreground">定金 {formatCurrency(row.original.deposit)}</div>
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
    {
      header: '操作',
      id: 'actions',
      cell: ({ row }) => {
        if (isRepairOrderAcceptable(row.original.status) && userId) {
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                acceptAndStartMutation.mutate({ id: row.original.id, userId });
              }}
            >
              接單
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" aria-hidden="true" />
            維修工作檯
          </h1>
          <p className="text-muted-foreground text-sm mt-1">待接案、接單、維修作業（接案人身分）</p>
        </div>
        <Button onClick={() => navigate(`${repairBase}/new`)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          新增維修單
        </Button>
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-muted/20 border rounded-xl">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" aria-hidden="true" />
          <Input
            placeholder="搜尋客戶、單號、IMEI..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("search", e.target.value);
                else next.delete("search");
                return next;
              }, { replace: true });
            }}
            className="pl-9 bg-background"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Badge
              key={t.value}
              variant={tab === t.value ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setTabWithParams(t.value)}
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