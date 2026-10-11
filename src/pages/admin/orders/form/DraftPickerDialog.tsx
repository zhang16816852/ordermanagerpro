import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { FolderOpen, PackageCheck, Send, ShoppingBag, Store, Trash2, Truck } from 'lucide-react';
import type { OrderDraft } from '@/store/useOrderDraftStore';
import { DRAFT_KIND_LABELS, selectDraftRows, type DraftKind } from './draftPicker';

interface StoreOption {
  id: string;
  name: string;
  code?: string | null;
}

interface DraftPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drafts: Record<string, OrderDraft>;
  stores: StoreOption[];
  currentKey: string;
  onOpenDraft: (key: string) => void;
  onDeleteDraft: (key: string) => void;
}

const KIND_ICONS: Record<DraftKind, typeof ShoppingBag> = {
  sales: ShoppingBag,
  purchase: Truck,
  consignment_receive: PackageCheck,
  consignment_send: Send,
};

export function DraftPickerDialog({
  open,
  onOpenChange,
  drafts,
  stores,
  currentKey,
  onOpenDraft,
  onDeleteDraft,
}: DraftPickerDialogProps) {
  const rows = selectDraftRows(drafts);
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

  const handleDelete = (key: string, isStoreDraft: boolean) => {
    const message = isStoreDraft
      ? '此草稿與門市端的購物車共用，刪除後門市端的購物車內容也會一併清空。確定要刪除嗎？'
      : '確定要刪除此草稿嗎？';
    if (window.confirm(message)) onDeleteDraft(key);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            選擇草稿
          </DialogTitle>
          <DialogDescription>
            選擇要載入的草稿，載入時會清空目前的品項與表頭並改為該草稿內容。
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">目前沒有可用的草稿</div>
        ) : (
          <div className="-mx-2 max-h-[60vh] space-y-2 overflow-y-auto px-2">
            {rows.map((row) => {
              const Icon = row.isStoreDraft ? Store : KIND_ICONS[row.context.kind];
              const title = row.isStoreDraft
                ? (storeNameById.get(row.context.storeId ?? '') ?? '未知門市')
                : DRAFT_KIND_LABELS[row.context.kind];
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{title}</span>
                      {row.isStoreDraft && (
                        <Badge variant="secondary" className="shrink-0">
                          {DRAFT_KIND_LABELS[row.context.kind]}
                        </Badge>
                      )}
                      {row.key === currentKey && (
                        <Badge variant="outline" className="shrink-0">
                          目前
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.itemCount} 件 · {formatCurrency(row.totalAmount)} ·{' '}
                      {formatDate(new Date(row.draft.updatedAt))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        onOpenDraft(row.key);
                        onOpenChange(false);
                      }}
                    >
                      開啟
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="刪除草稿"
                      onClick={() => handleDelete(row.key, row.isStoreDraft)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
