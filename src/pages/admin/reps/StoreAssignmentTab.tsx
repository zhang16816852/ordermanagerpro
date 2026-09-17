import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { StorePicker } from '@/components/ui/StorePicker';
import { Search, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Dispatch, SetStateAction } from 'react';
import type { RepRecord, ProfileRecord, AssignableStore } from '../repsTypes';

interface StoreAssignmentTabProps {
  filteredAssignReps: RepRecord[];
  reps: RepRecord[];
  profileOf: (userId: string) => ProfileRecord | undefined;
  stores: AssignableStore[];
  assignmentStores: (repId: string) => AssignableStore[];
  assignSearch: string;
  setAssignSearch: (v: string) => void;
  grantStoreIds: Record<string, string[]>;
  setGrantStoreIds: Dispatch<SetStateAction<Record<string, string[]>>>;
  grantPending: boolean;
  onGrant: (repId: string, storeId: string) => Promise<void>;
  onRevoke: (repId: string, storeId: string) => void;
}

export function StoreAssignmentTab({
  filteredAssignReps,
  reps,
  profileOf,
  stores,
  assignmentStores,
  assignSearch,
  setAssignSearch,
  grantStoreIds,
  setGrantStoreIds,
  grantPending,
  onGrant,
  onRevoke,
}: StoreAssignmentTabProps) {
  return (
    <>
      <div className="flex justify-end mb-4">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋業務姓名 / Email"
            className="pl-10"
            value={assignSearch}
            onChange={(e) => setAssignSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {filteredAssignReps.map((r) => {
          const p = profileOf(r.user_id);
          const assigned = assignmentStores(r.user_id);
          const assignedIds = new Set(assigned.map(s => s.id));
          const assignableStores = stores.filter(s => !assignedIds.has(s.id));
          return (
            <Card key={r.user_id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {p?.full_name || '業務'} <span className="text-muted-foreground font-normal text-sm">({p?.email})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assigned.length === 0 ? (
                  <p className="text-sm text-muted-foreground">尚未分配任何店家</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {assigned.map((s) => (
                      <Badge key={s.id} variant="secondary" className="gap-1">
                        {s.name}
                        <button
                          onClick={() => onRevoke(r.user_id, s.id)}
                          className="ml-1 text-muted-foreground hover:text-destructive"
                          aria-label="解除分配"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2 pt-2 border-t border-border">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">新增店家（可多選）</Label>
                    <StorePicker
                      stores={assignableStores.map(s => ({ id: s.id, name: s.name, code: s.code }))}
                      value={grantStoreIds[r.user_id] || []}
                      onChange={(values) => {
                        const arr = Array.isArray(values) ? values : values ? [values] : [];
                        setGrantStoreIds(prev => ({ ...prev, [r.user_id]: arr }));
                      }}
                      multiple
                      placeholder="選擇店家（可多選）"
                      searchPlaceholder="搜尋店家名稱 / 代碼"
                      notFoundText="找不到相符的店家"
                    />
                  </div>
                  {(() => {
                    const assignableIds = new Set(assignableStores.map(s => s.id));
                    const pendingStoreIds = (grantStoreIds[r.user_id] || []).filter(sid => assignableIds.has(sid));
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={pendingStoreIds.length === 0 || grantPending}
                        onClick={async () => {
                          if (pendingStoreIds.length === 0) return;
                          try {
                            await Promise.all(pendingStoreIds.map(sid => onGrant(r.user_id, sid)));
                            setGrantStoreIds(prev => ({ ...prev, [r.user_id]: [] }));
                            toast.success(`已分配 ${pendingStoreIds.length} 家店家`);
                          } catch { /* 單筆失敗由 mutation onError toast */ }
                        }}
                      >
                        <Check className="mr-1 h-4 w-4" />分配
                        {pendingStoreIds.length > 0 ? `（${pendingStoreIds.length}）` : ''}
                      </Button>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {reps.length === 0 && (
        <p className="text-muted-foreground text-center py-8">尚無業務帳號</p>
      )}
      {reps.length > 0 && filteredAssignReps.length === 0 && (
        <p className="text-muted-foreground text-center py-8">找不到相符的業務</p>
      )}
    </>
  );
}