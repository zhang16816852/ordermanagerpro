import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { History, Search, Filter, Eye, User, FileJson } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useAuditLogs, AuditLogItem } from './hooks/useAuditLogs';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function AdminAuditLogs() {
    const [page, setPage] = useState(1);
    const [pageSize] = useState(15);
    const [entityType, setEntityType] = useState('all');
    const [action, setAction] = useState('all');
    const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

    const { data, isLoading } = useAuditLogs({
        page,
        pageSize,
        entityType,
        action
    });

    const columns = [
        {
            header: "時間",
            accessorKey: "created_at",
            cell: ({ row }: { row: { original: AuditLogItem } }) => (
                <div className="text-xs">
                    {format(new Date(row.original.created_at), "yyyy/MM/dd HH:mm:ss", { locale: zhTW })}
                </div>
            )
        },
        {
            header: "操作人員",
            accessorKey: "performed_by",
            cell: ({ row }: { row: { original: AuditLogItem } }) => (
                <div className="flex items-center gap-2">
                    <User className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{row.original.profiles?.full_name || '系統'}</span>
                    <span className="text-[10px] text-muted-foreground hidden md:inline">({row.original.profiles?.email || '-'})</span>
                </div>
            )
        },
        {
            header: "類型",
            accessorKey: "entity_type",
            cell: ({ row }: { row: { original: AuditLogItem } }) => (
                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                    {translateEntityType(row.original.entity_type)}
                </span>
            )
        },
        {
            header: "動作",
            accessorKey: "action",
            cell: ({ row }: { row: { original: AuditLogItem } }) => {
                const action = row.original.action;
                const statusMap: Record<string, string> = {
                    'INSERT': 'paid',
                    'DELETE': 'unpaid',
                    'UPDATE': 'reconciled'
                };
                return (
                    <StatusBadge
                        type="accounting"
                        status={statusMap[action] || 'reconciled'}
                    />
                );
            }
        },
        {
            header: "操作內容",
            accessorKey: "id",
            cell: ({ row }: { row: { original: AuditLogItem } }) => (
                <Button variant="ghost" size="sm" onClick={() => setSelectedLog(row.original)} className="h-8 gap-2">
                    <Eye className="h-4 w-4" /> 查看細節
                </Button>
            )
        }
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">操作日誌</h1>
                    <p className="text-muted-foreground">追蹤系統中所有的資料變更與管理操作</p>
                </div>
            </div>

            <Card className="border-none shadow-soft">
                <CardHeader className="pb-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1">
                            <Select value={entityType} onValueChange={setEntityType}>
                                <SelectTrigger className="w-full md:w-64 bg-background">
                                    <Filter className="mr-2 h-4 w-4" />
                                    <SelectValue placeholder="篩選實體類型" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">所有類型</SelectItem>
                                    <SelectItem value="products">產品</SelectItem>
                                    <SelectItem value="orders">訂單</SelectItem>
                                    <SelectItem value="order_items">訂單項次</SelectItem>
                                    <SelectItem value="accounting_entries">會計分錄</SelectItem>
                                    <SelectItem value="sales_notes">銷售單</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex gap-2">
                            <Select value={action} onValueChange={setAction}>
                                <SelectTrigger className="w-40 bg-background">
                                    <SelectValue placeholder="動作" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">所有動作</SelectItem>
                                    <SelectItem value="INSERT">建立</SelectItem>
                                    <SelectItem value="UPDATE">更新</SelectItem>
                                    <SelectItem value="DELETE">刪除</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={data?.logs || []}
                        isLoading={isLoading}
                        pagination={{
                            pageIndex: page - 1,
                            pageSize: pageSize,
                            pageCount: Math.ceil((data?.total || 0) / pageSize),
                            onPageChange: (idx) => setPage(idx + 1)
                        }}
                    />
                </CardContent>
            </Card>

            {/* Log Detail Dialog */}
            <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileJson className="h-5 w-5 text-primary" />
                            變更細節對比
                        </DialogTitle>
                    </DialogHeader>

                    {selectedLog && (
                        <div className="flex-1 overflow-y-auto space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                        以前的內容
                                    </h4>
                                    <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto h-64 border">
                                        {JSON.stringify(selectedLog.old_value, null, 2)}
                                    </pre>
                                </div>
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-emerald-600 flex items-center gap-2">
                                        更新後的內容
                                    </h4>
                                    <pre className="text-xs bg-emerald-50/50 p-4 rounded-lg overflow-x-auto h-64 border border-emerald-100">
                                        {JSON.stringify(selectedLog.new_value, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function translateEntityType(type: string): string {
    const map: Record<string, string> = {
        'products': '產品',
        'orders': '訂單',
        'order_items': '訂單項次',
        'accounting_entries': '會計分錄',
        'sales_notes': '銷售單',
        'stores': '店鋪',
        'profiles': '使用者',
        'product_variants': '產品規格'
    };
    return map[type] || type;
}

function translateAction(action: string): string {
    const map: Record<string, string> = {
        'INSERT': '建立',
        'UPDATE': '更新',
        'DELETE': '刪除'
    };
    return map[action] || action;
}
