import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Pencil, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

type Store = Tables<'stores'>;
type StoreInsert = TablesInsert<'stores'>;

interface StoreWithMembers extends Store {
  store_users: { count: number }[];
}

export default function AdminStores() {
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const queryClient = useQueryClient();

  const { data: stores, isLoading } = useQuery({
    queryKey: ['admin-stores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('*, store_users(count)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as StoreWithMembers[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (store: StoreInsert) => {
      const { error } = await supabase.from('stores').insert(store);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
      toast.success('店鋪已新增');
      setIsDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`新增失敗：${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Store> & { id: string }) => {
      const { error } = await supabase.from('stores').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
      toast.success('店鋪已更新');
      setIsDialogOpen(false);
      setEditingStore(null);
    },
    onError: (error) => {
      toast.error(`更新失敗：${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const storeData = {
      name: formData.get('name') as string,
      code: (formData.get('code') as string) || null,
      brand: (formData.get('brand') as string) || null,
      address: (formData.get('address') as string) || null,
      phone: (formData.get('phone') as string) || null,
    };

    if (editingStore) {
      updateMutation.mutate({ id: editingStore.id, ...storeData });
    } else {
      createMutation.mutate(storeData as any);
    }
  };

  const filteredStores = stores?.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code?.toLowerCase().includes(search.toLowerCase())
  );

  const openEditDialog = (store: Store) => {
    setEditingStore(store);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingStore(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">店鋪管理</h1>
          <p className="text-muted-foreground">管理所有加盟店鋪</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>

          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditingStore(null);
                setIsDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              新增店鋪
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingStore ? '編輯店鋪' : '新增店鋪'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">店鋪名稱</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={editingStore?.name}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">店鋪代碼</Label>
                  <Input
                    id="code"
                    name="code"
                    defaultValue={editingStore?.code || ''}
                    placeholder="例：TP001"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand">品牌</Label>
                <Input
                  id="brand"
                  name="brand"
                  defaultValue={(editingStore as any)?.brand || ''}
                  placeholder="例：雷神快修"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">地址</Label>
                <Input
                  id="address"
                  name="address"
                  defaultValue={editingStore?.address || ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">電話</Label>
                <Input
                  id="phone"
                  name="phone"
                  defaultValue={editingStore?.phone || ''}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  取消
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingStore ? '儲存' : '新增'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋店鋪名稱或代碼..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-soft">
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
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : filteredStores?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  沒有找到店鋪
                </TableCell>
              </TableRow>
            ) : (
              filteredStores?.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="font-mono text-sm">
                    {store.code || '-'}
                  </TableCell>
                  <TableCell className="font-medium">{store.name}</TableCell>
                  <TableCell>
                    {(store as any).brand ? (
                      <Badge variant="secondary">{(store as any).brand}</Badge>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {store.address || '-'}
                  </TableCell>
                  <TableCell>{store.phone || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      <Users className="h-3 w-3" />
                      {store.store_users?.[0]?.count ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(store)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
