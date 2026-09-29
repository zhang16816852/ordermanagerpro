import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRepairPartTags, useRepairPartTagMutations } from '@/hooks/useRepairParts';

interface RepairPartTagsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RepairPartTagsManager({ open, onOpenChange }: RepairPartTagsManagerProps) {
  const { tags } = useRepairPartTags();
  const { createTagMutation, deleteTagMutation } = useRepairPartTagMutations();
  const [newTag, setNewTag] = useState('');

  const handleAdd = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    createTagMutation.mutate(trimmed, { onSuccess: () => setNewTag('') });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>零件標籤字典</DialogTitle>
          <DialogDescription>
            標籤用於零件型錄的分類與篩選，刪除標籤不會影響已綁定此名稱的零件。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="輸入標籤名稱"
            className="h-9"
          />
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0"
            disabled={!newTag.trim() || createTagMutation.isPending}
            onClick={handleAdd}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border">
          {tags.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">尚無標籤</p>
          ) : (
            tags.map(t => (
              <div key={t.id} className="flex items-center justify-between border-b last:border-0 px-3 py-2">
                <span className="text-sm">#{t.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  aria-label={`刪除標籤 ${t.name}`}
                  disabled={deleteTagMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`確定刪除標籤「${t.name}」？`)) deleteTagMutation.mutate(t.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
