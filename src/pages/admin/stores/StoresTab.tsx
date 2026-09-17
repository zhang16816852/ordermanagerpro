import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Search, Users, Pencil, Store } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { StoresController } from './useStoresController';

export function StoresTab({ c }: { c: StoresController }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋店鋪名稱或代碼..."
            value={c.storeSearch}
            onChange={(e) => c.onStoreSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={c.isStoreDialogOpen} onOpenChange={c.setIsStoreDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { c.setEditingStore(null); c.setIsStoreDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              新增店鋪
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{c.editingStore ? '編輯店鋪' : '新增店鋪'}</DialogTitle>
              <DialogDescription>請輸入店鋪的基本聯絡資訊與系統識別代碼。</DialogDescription>
            </DialogHeader>
            <form onSubmit={c.handleStoreSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">店鋪名稱</Label>
                  <Input id="name" name="name" defaultValue={c.editingStore?.name} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">店鋪代碼</Label>
                  <Input id="code" name="code" defaultValue={c.editingStore?.code || ''} placeholder="例：TP001" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand">品牌</Label>
                <Input id="brand" name="brand" defaultValue={(c.editingStore as any)?.brand || ''} placeholder="例：雷神快修" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">地址</Label>
                <Input id="address" name="address" defaultValue={c.editingStore?.address || ''} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">電話</Label>
                <Input id="phone" name="phone" defaultValue={c.editingStore?.phone || ''} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => { c.setIsStoreDialogOpen(false); c.setEditingStore(null); }}>
                  取消
                </Button>
                <Button type="submit" disabled={c.createStoreMutation.isPending || c.updateStoreMutation.isPending}>
                  {c.editingStore ? '儲存' : '新增'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card shadow-soft">
        {/* Desktop: Table */}
        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代碼</TableHead>
              <TableHead>名稱</TableHead>
              <TableHead>品牌</TableHead>
              <TableHead>地址</TableHead>
              <TableHead>電話</TableHead>
              <TableHead>成員數</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.storesLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : c.filteredStores?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  沒有找到店鋪
                </TableCell>
              </TableRow>
            ) : (
              c.filteredStores?.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="font-mono text-sm">{store.code || '-'}</TableCell>
                  <TableCell className="font-medium">{store.name}</TableCell>
                  <TableCell>
                    {(store as any).brand ? (
                      <Badge variant="secondary">{(store as any).brand}</Badge>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {store.address || '-'}
                  </TableCell>
                  <TableCell>{store.phone || '-'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 hover:bg-transparent"
                      onClick={() => c.openMembersDialog(store)}
                      title="檢視成員"
                    >
                      <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/80">
                        <Users className="h-3 w-3" />
                        {store.store_users?.[0]?.count ?? 0}
                      </Badge>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" aria-label="編輯門市" onClick={() => { c.setEditingStore(store); c.setIsStoreDialogOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>

        {/* Mobile: Cards */}
        <div className="md:hidden">
          {c.storesLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : c.filteredStores?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">沒有找到店鋪</div>
          ) : (
            <div className="divide-y">
              {c.filteredStores?.map((store) => (
                <div key={store.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{store.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{store.code || '-'}</p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="編輯門市" onClick={() => { c.setEditingStore(store); c.setIsStoreDialogOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {(store as any).brand && <Badge variant="secondary">{(store as any).brand}</Badge>}
                    {store.phone && <span>{store.phone}</span>}
                  </div>
                  {store.address && (
                    <p className="text-xs text-muted-foreground truncate">{store.address}</p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => c.openMembersDialog(store)}
                  >
                    <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/80">
                      <Users className="h-3 w-3" />
                      {store.store_users?.[0]?.count ?? 0} 位成員
                    </Badge>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}