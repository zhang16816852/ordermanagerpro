import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessages";
import { format } from "date-fns";
import { EntryDialog } from "@/pages/admin/accounting/components/EntryDialog";
import {
  AccountingEntry,
  AccountingEntryReference,
  AccountingCategory,
  Account,
} from "@/pages/admin/accounting/types";

export interface BatchEligibleNote {
  id: string;
  code: string;
  storeId: string;
  storeName?: string;
  created_at: string;
  totalAmount: number;
}

interface SalesNoteBatchPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: BatchEligibleNote[];
  onCompleted?: () => void;
}

export function SalesNoteBatchPaymentDialog({
  open,
  onOpenChange,
  notes,
  onCompleted,
}: SalesNoteBatchPaymentDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("accounts") as any)
        .select("id, name, type, currency, balance, description, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as Account[];
    },
    enabled: open,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["accounting-categories"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("accounting_categories") as any)
        .select("id, name, type, description, is_active")
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as AccountingCategory[];
    },
    enabled: open,
  });

  // 預設帶入「銷貨類收入」分類，找不到再回退第一個收入分類
  const salesCategoryId = useMemo(() => {
    if (categories.length === 0) return undefined;
    const salesCategory = categories.find(
      (c) => c.type === "income" && (c.name.includes("銷貨") || c.name.includes("銷售"))
    );
    return salesCategory?.id || categories.find((c) => c.type === "income")?.id;
  }, [categories]);

  const totalAmount = notes.reduce((sum, note) => sum + (note.totalAmount || 0), 0);

  const batchPaymentMutation = useMutation({
    mutationFn: async ({ data, references }: { data: Partial<AccountingEntry>; references?: AccountingEntryReference[] }) => {
      const { data: newEntry, error: entryError } = await (supabase
        .from("accounting_entries") as any)
        .insert({ ...data, created_by: user?.id })
        .select("id")
        .single();
      if (entryError) throw entryError;

      if (references && references.length > 0 && newEntry) {
        const refsToInsert = references.map((ref) => ({
          entry_id: newEntry.id,
          reference_type: ref.reference_type,
          reference_id: ref.reference_id,
          item_name: ref.item_name,
          amount_applied: ref.amount_applied,
        }));
        const { error: refError } = await (supabase as any)
          .from("accounting_entry_references")
          .insert(refsToInsert);
        if (refError) throw refError;
      }

      if (data.account_id && data.amount) {
        const account = accounts.find((a: Account) => a.id === data.account_id);
        if (account) {
          const { error: accError } = await (supabase
            .from("accounts") as any)
            .update({ balance: account.balance + (data.amount || 0) })
            .eq("id", data.account_id);
          if (accError) throw accError;
        }
      }

      // 用 RPC 統一同步收款狀態——必須涵蓋 entry row 綁定的單據與 references 子表全部單據
      const salesNoteIds = new Set<string>();
      if (data.reference_type === "sales_note" && data.reference_id) {
        salesNoteIds.add(data.reference_id);
      }
      for (const ref of references || []) {
        if (ref.reference_type === "sales_note" && ref.reference_id) {
          salesNoteIds.add(ref.reference_id);
        }
      }
      for (const noteId of salesNoteIds) {
        const { error: noteError } = await (supabase as any)
          .rpc("sync_sales_note_payment_status", { p_sales_note_id: noteId });
        if (noteError) throw noteError;
      }

      // 同一筆分錄可能同時關聯維修單（跨單結帳），維修單收款狀態也必須同步
      const repairOrderIds = new Set<string>();
      if (data.reference_type === "repair_order" && data.reference_id) {
        repairOrderIds.add(data.reference_id);
      }
      for (const ref of references || []) {
        if (ref.reference_type === "repair_order" && ref.reference_id) {
          repairOrderIds.add(ref.reference_id);
        }
      }
      for (const roId of repairOrderIds) {
        const { error: repairError } = await (supabase as any)
          .rpc("sync_repair_order_payment_status", { p_repair_order_id: roId });
        if (repairError) throw repairError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-entries"] });
      queryClient.invalidateQueries({ queryKey: ["sales-note-payment"] });
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["store-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["repair_orders"] });
      onOpenChange(false);
      onCompleted?.();
      toast.success(`批次收款已記錄（${notes.length} 筆）`);
    },
    onError: (error: unknown) => {
      toast.error(`批次收款記錄失敗: ${getErrorMessage(error)}`);
    },
  });

  const firstNote = notes[0];
  if (!firstNote || notes.length === 0) return null;

  return (
    <EntryDialog
      open={open}
      onOpenChange={onOpenChange}
      categories={categories}
      accounts={accounts}
      isLoading={batchPaymentMutation.isPending}
      prefill={{
        amount: totalAmount,
        categoryId: salesCategoryId,
        description: `銷貨單收款: ${notes.length} 筆`,
        referenceType: "sales_note",
        referenceId: firstNote.id,
        transactionDate: format(new Date(), "yyyy-MM-dd"),
        markAsPaid: true,
        docItems: notes.map((note) => ({
          docType: "sales_note",
          docId: note.id,
          code: note.code || note.id.slice(0, 8),
          name: note.storeName || "未知店家",
          date: note.created_at,
          originalAmount: note.totalAmount,
          amountApplied: note.totalAmount,
        })),
      }}
      onSubmit={(data, references) => batchPaymentMutation.mutate({ data, references })}
    />
  );
}