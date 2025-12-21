import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Eye, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toast } from 'sonner';

interface SalesNoteWithItems {
  id: string;
  status: 'draft' | 'shipped' | 'received';
  shipped_at: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  sales_note_items: {
    id: string;
    quantity: number;
    order_items: {
      id: string;
      products: { name: string; sku: string } | null;
    } | null;
  }[];
}

const statusLabels: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-muted text-muted-foreground' },
  shipped: { label: '已出貨', className: 'bg-status-partial text-primary-foreground' },
  received: { label: '已收貨', className: 'bg-status-shipped text-success-foreground' },
};

export default function StoreSalesNotes() {
  const { storeRoles, user } = useAuth();
  const storeId = storeRoles[0]?.store_id;
  const [selectedNote, setSelectedNote] = useState<SalesNoteWithItems | null>(null);
  const queryClient = useQueryClient();

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ['store-sales-notes', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await supabase
        .from('sales_notes')
        .select(`
          id,
          status,
          shipped_at,
          received_at,
          notes,
          created_at,
          sales_note_items (
            id,
            quantity,
            order_items (
              id,
              products (name, sku)
            )
          )
        `)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SalesNoteWithItems[];
    },
    enabled: !!storeId,
  });

  const confirmReceiveMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase
        .from('sales_notes')
        .update({
          status: 'received',
          received_at: new Date().toISOString(),
          received_by: user?.id,
        })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
      toast.success('已確認收貨');
      setSelectedNote(null);
    },
    onError: (error) => {
      toast.error(`確認失敗：${error.message}`);
    },
  });

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">您尚未被指派到任何店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">銷貨單管理</h1>
        <p className="text-muted-foreground">查看與確認收貨</p>
      </div>

      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>銷貨單編號</TableHead>
              <TableHead>品項數</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>出貨時間</TableHead>
              <TableHead>收貨時間</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : salesNotes?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  沒有銷貨單
                </TableCell>
              </TableRow>
            ) : (
              salesNotes?.map((note) => {
                const statusInfo = statusLabels[note.status];
                return (
                  <TableRow key={note.id}>
                    <TableCell className="font-mono text-sm">
                      {note.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{note.sales_note_items.length}</TableCell>
                    <TableCell>
                      <Badge className={statusInfo.className}>
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {note.shipped_at
                        ? format(new Date(note.shipped_at), 'MM/dd HH:mm', { locale: zhTW })
                        : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {note.received_at
                        ? format(new Date(note.received_at), 'MM/dd HH:mm', { locale: zhTW })
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedNote(note)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selectedNote} onOpenChange={() => setSelectedNote(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>銷貨單詳情</DialogTitle>
          </DialogHeader>
          {selectedNote && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">銷貨單編號：</span>
                  <span className="font-mono">{selectedNote.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">狀態：</span>
                  <Badge className={statusLabels[selectedNote.status].className}>
                    {statusLabels[selectedNote.status].label}
                  </Badge>
                </div>
                {selectedNote.shipped_at && (
                  <div>
                    <span className="text-muted-foreground">出貨時間：</span>
                    <span>
                      {format(new Date(selectedNote.shipped_at), 'yyyy/MM/dd HH:mm', {
                        locale: zhTW,
                      })}
                    </span>
                  </div>
                )}
                {selectedNote.received_at && (
                  <div>
                    <span className="text-muted-foreground">收貨時間：</span>
                    <span>
                      {format(new Date(selectedNote.received_at), 'yyyy/MM/dd HH:mm', {
                        locale: zhTW,
                      })}
                    </span>
                  </div>
                )}
              </div>
              {selectedNote.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">備註：</span>
                  <span>{selectedNote.notes}</span>
                </div>
              )}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>產品名稱</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedNote.sales_note_items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">
                          {item.order_items?.products?.sku}
                        </TableCell>
                        <TableCell>{item.order_items?.products?.name}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {selectedNote.status === 'shipped' && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => confirmReceiveMutation.mutate(selectedNote.id)}
                    disabled={confirmReceiveMutation.isPending}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    確認收貨
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
