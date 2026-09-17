import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Dispatch, SetStateAction } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

interface CommissionDialogProps {
  show: boolean;
  onShowChange: (v: boolean) => void;
  editingRep: { userId: string; commission: string } | null;
  onEditingChange: Dispatch<SetStateAction<{ userId: string; commission: string } | null>>;
  mutation: UseMutationResult<void, Error, { userId: string; commission: number }, unknown>;
}

export function CommissionDialog({ show, onShowChange, editingRep, onEditingChange, mutation }: CommissionDialogProps) {
  return (
    <Dialog open={show} onOpenChange={onShowChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>設定佣金比例</DialogTitle>
          <DialogDescription>佣金 = (售價 - 業務成本) × 比例</DialogDescription>
        </DialogHeader>
        {editingRep && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>佣金比例（%）</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={editingRep.commission}
                onChange={(e) => onEditingChange(prev => prev ? { ...prev, commission: e.target.value } : prev)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onShowChange(false)}>取消</Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              if (!editingRep) return;
              const num = Number(editingRep.commission);
              if (Number.isNaN(num) || num < 0 || num > 100) {
                toast.error('請輸入 0-100 的數字');
                return;
              }
              mutation.mutate({ userId: editingRep.userId, commission: num });
            }}
          >
            {mutation.isPending ? '儲存中…' : '儲存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}