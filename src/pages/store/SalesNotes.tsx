import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { SalesNoteListTable } from '@/components/sales/SalesNoteListTable';
import { SalesNoteDetailDialog } from '@/components/sales/SalesNoteDetailDialog';
import type { SalesNoteDetail } from '@/components/sales/SalesNoteDetailDialog';

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
      product_variants: { name: string } | null;
    } | null;
  }[];
}

interface SalesNoteSummary {
  id: string;
  status: string;
  itemCount: number;
  created_at: string;
  shipped_at?: string | null;
  received_at?: string | null;
}

export default function StoreSalesNotes() {
  const { storeRoles, user } = useAuth();
  const storeId = storeRoles[0]?.store_id;
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
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
              products (name, sku),
              product_variants (name)
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
      setSelectedNoteId(null);
    },
    onError: (error) => {
      toast.error(`確認失敗：${error.message}`);
    },
  });

  // Map the raw data to SalesNoteSummary format for the table
  const mappedSalesNotes = useMemo<SalesNoteSummary[]>(() => {
    if (!salesNotes) return [];
    return salesNotes.map((note) => ({
      id: note.id,
      status: note.status,
      itemCount: note.sales_note_items.length,
      created_at: note.created_at,
      shipped_at: note.shipped_at,
      received_at: note.received_at,
    }));
  }, [salesNotes]);

  // Map the selected note to SalesNoteDetail format for the dialog
  const selectedNoteDetail = useMemo<SalesNoteDetail | null>(() => {
    if (!selectedNoteId || !salesNotes) return null;
    const note = salesNotes.find((n) => n.id === selectedNoteId);
    if (!note) return null;

    return {
      id: note.id,
      status: note.status,
      created_at: note.created_at,
      shipped_at: note.shipped_at,
      received_at: note.received_at,
      notes: note.notes,
      items: note.sales_note_items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        productSku: item.order_items?.products?.sku || '',
        productName: item.order_items?.products?.name || '',
        variantName: item.order_items?.product_variants?.name || null,
      })),
    };
  }, [selectedNoteId, salesNotes]);

  const handleConfirmReceive = (noteId: string) => {
    confirmReceiveMutation.mutate(noteId);
  };

  const handleViewNote = (note: SalesNoteSummary) => {
    setSelectedNoteId(note.id);
  };

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

      <SalesNoteListTable
        data={mappedSalesNotes}
        isLoading={isLoading}
        onView={handleViewNote}
        showStoreColumn={false}
      />

      <SalesNoteDetailDialog
        note={selectedNoteDetail}
        open={!!selectedNoteId}
        onOpenChange={(open) => !open && setSelectedNoteId(null)}
        onConfirmReceive={handleConfirmReceive}
        isConfirming={confirmReceiveMutation.isPending}
      />
    </div>
  );
}
