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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Search, Users, Store, Mail, Copy, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

type Store = Tables<'stores'>;
type StoreInsert = TablesInsert<'stores'>;

interface StoreWithMembers extends Store {
  store_users: { count: number }[];
}

type StoreUserRecord = {
  id: string;
  user_id: string;
  role: string;
  store_id: string;
  profile?: { email: string; full_name: string | null; phone: string | null };
};

export default function AdminStores() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // --- Shared state ---
  const [storeSearch, setStoreSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');

  // --- Store CRUD state ---
  const [isStoreDialogOpen, setIsStoreDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);

  // --- Store Members dialog ---
  const [showMembersDialog, setShowMembersDialog] = useState(false);
  const [membersStore, setMembersStore] = useState<StoreWithMembers | null>(null);

  // --- User assignment state ---
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('employee');

  // --- Invite state ---
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  // ==================== QUERIES ====================

  const { data: stores, isLoading: storesLoading } = useQuery({
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

  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['admin-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ['admin-user-roles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id, role');
      if (error) throw error;
      return data;
    },
  });

  const { data: storeUsers } = useQuery({
    queryKey: ['admin-store-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_users')
        .select(`
          id,
          user_id,
          role,
          store_id,
          store:stores(name, code)
        `);
      if (error) throw error;
      return data;
    },
  });

  const { data: storesList } = useQuery({
    queryKey: ['admin-stores-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: invitations } = useQuery({
    queryKey: ['admin-invitations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('*, stores(name, code)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profilesForStore } = useQuery({
    queryKey: ['admin-profiles-for-store'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone');
      if (error) throw error;
      return data;
    },
  });

  // ==================== MUTATIONS ====================

  const createStoreMutation = useMutation({
    mutationFn: async (store: StoreInsert) => {
      const { error } = await supabase.from('stores').insert(store);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
      toast.success('店鋪已新增');
      setIsStoreDialogOpen(false);
    },
    onError: (err) => toast.error(`新增失敗：${err.message}`),
  });

  const updateStoreMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Store> & { id: string }) => {
      const { error } = await supabase.from('stores').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
      toast.success('店鋪已更新');
      setIsStoreDialogOpen(false);
      setEditingStore(null);
    },
    onError: (err) => toast.error(`更新失敗：${err.message}`),
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !selectedStoreId) throw new Error('請選擇用戶和店鋪');
      const { data: existing } = await supabase
        .from('store_users')
        .select('id')
        .eq('user_id', selectedUserId)
        .eq('store_id', selectedStoreId)
        .single();
      if (existing) {
        const { error } = await supabase
          .from('store_users')
          .update({ role: selectedRole as 'founder' | 'manager' | 'employee' })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('store_users')
          .insert({ user_id: selectedUserId, store_id: selectedStoreId, role: selectedRole as 'founder' | 'manager' | 'employee' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('已指派店鋪成員');
      setShowAssignDialog(false);
      setSelectedUserId(null);
      setSelectedStoreId('');
      setSelectedRole('employee');
      queryClient.invalidateQueries({ queryKey: ['admin-store-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeStoreMutation = useMutation({
    mutationFn: async (storeUserId: string) => {
      const { error } = await supabase.from('store_users').delete().eq('id', storeUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已移除店鋪成員');
      queryClient.invalidateQueries({ queryKey: ['admin-store-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!user || !selectedStoreId || !inviteEmail) throw new Error('請填寫完整資料');
      const { error } = await supabase.from('invitations').insert({
        email: inviteEmail,
        store_id: selectedStoreId,
        role: selectedRole as 'founder' | 'manager' | 'employee',
        invited_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('邀請已發送');
      setShowInviteDialog(false);
      setInviteEmail('');
      setSelectedStoreId('');
      setSelectedRole('employee');
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ==================== HELPERS ====================

  const getUserRoles = (userId: string) =>
    userRoles?.filter((r) => r.user_id === userId).map((r) => r.role) || [];

  const getUserStores = (userId: string) =>
    storeUsers?.filter((s) => s.user_id === userId) || [];

  const getStoreMembers = (storeId: string) =>
    storeUsers?.filter((s) => s.store_id === storeId) || [];

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin': return <Badge className="bg-red-500">管理員</Badge>;
      case 'customer': return <Badge variant="secondary">用戶</Badge>;
      default: return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getStoreRoleBadge = (role: string) => {
    switch (role) {
      case 'founder': return <Badge className="bg-purple-500">創辦人</Badge>;
      case 'manager': return <Badge className="bg-blue-500">經理</Badge>;
      case 'employee': return <Badge variant="secondary">員工</Badge>;
      default: return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getInviteLink = (token: string) =>
    `${window.location.origin}/invite/${token}`;

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(getInviteLink(token));
    toast.success('邀請連結已複製');
  };

  const openAssignDialog = (userId: string) => {
    setSelectedUserId(userId);
    setShowAssignDialog(true);
  };

  const openMembersDialog = (store: StoreWithMembers) => {
    setMembersStore(store);
    setShowMembersDialog(true);
  };

  const handleStoreSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      code: (formData.get('code') as string) || null,
      brand: (formData.get('brand') as string) || null,
      address: (formData.get('address') as string) || null,
      phone: (formData.get('phone') as string) || null,
    };
    if (editingStore) {
      updateStoreMutation.mutate({ id: editingStore.id, ...data });
    } else {
      createStoreMutation.mutate(data as any);
    }
  };

  const filteredStores = stores?.filter(
    (s) =>
      s.name.toLowerCase().includes(storeSearch.toLowerCase()) ||
      s.code?.toLowerCase().includes(storeSearch.toLowerCase()),
  );

  const filteredProfiles = profiles?.filter((profile) => {
    const q = userSearch.toLowerCase();
    const matchesSearch =
      profile.email.toLowerCase().includes(q) ||
      profile.full_name?.toLowerCase().includes(q) ||
      profile.phone?.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (storeFilter !== 'all') {
      const userStores = getUserStores(profile.id);
      if (storeFilter === 'none') {
        if (userStores.length > 0) return false;
      } else {
        if (!userStores.some((s) => s.store_id === storeFilter)) return false;
      }
    }

    if (roleFilter !== 'all') {
      const roles = getUserRoles(profile.id);
      if (!roles.includes(roleFilter)) return false;
    }

    return true;
  });

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">店鋪管理</h1>
          <p className="text-muted-foreground">管理店鋪資訊與系統人員</p>
        </div>
      </div>

      <Tabs defaultValue="stores" className="space-y-6">
        <TabsList>
          <TabsTrigger value="stores" className="gap-2">
            <Store className="h-4 w-4" />
            店鋪管理
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            人員管理
          </TabsTrigger>
          {invitations && invitations.length > 0 && (
            <TabsTrigger value="invitations" className="gap-2 relative">
              <Mail className="h-4 w-4" />
              待處理邀請
              <Badge variant="destructive" className="ml-1 h-5 w-5 rounded-full p-0 text-[10px]">
                {invitations.length}
              </Badge>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ==================== STORES TAB ==================== */}
        <TabsContent value="stores" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜尋店鋪名稱或代碼..."
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Dialog open={isStoreDialogOpen} onOpenChange={setIsStoreDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => { setEditingStore(null); setIsStoreDialogOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  新增店鋪
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingStore ? '編輯店鋪' : '新增店鋪'}</DialogTitle>
                  <DialogDescription>請輸入店鋪的基本聯絡資訊與系統識別代碼。</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleStoreSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">店鋪名稱</Label>
                      <Input id="name" name="name" defaultValue={editingStore?.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="code">店鋪代碼</Label>
                      <Input id="code" name="code" defaultValue={editingStore?.code || ''} placeholder="例：TP001" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand">品牌</Label>
                    <Input id="brand" name="brand" defaultValue={(editingStore as any)?.brand || ''} placeholder="例：雷神快修" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">地址</Label>
                    <Input id="address" name="address" defaultValue={editingStore?.address || ''} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">電話</Label>
                    <Input id="phone" name="phone" defaultValue={editingStore?.phone || ''} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => { setIsStoreDialogOpen(false); setEditingStore(null); }}>
                      取消
                    </Button>
                    <Button type="submit" disabled={createStoreMutation.isPending || updateStoreMutation.isPending}>
                      {editingStore ? '儲存' : '新增'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
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
                {storesLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
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
                          onClick={() => openMembersDialog(store)}
                          title="檢視成員"
                        >
                          <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/80">
                            <Users className="h-3 w-3" />
                            {store.store_users?.[0]?.count ?? 0}
                          </Badge>
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => { setEditingStore(store); setIsStoreDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ==================== USERS TAB ==================== */}
        <TabsContent value="users" className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜尋用戶（Email、姓名、電話）..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="w-[180px]">
                  <Store className="h-3.5 w-3.5 mr-1" />
                  <SelectValue placeholder="所有店鋪" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有店鋪</SelectItem>
                  <SelectItem value="none">無所屬店鋪</SelectItem>
                  {storesList?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code ? `${s.code} - ${s.name}` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="所有角色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有角色</SelectItem>
                  <SelectItem value="admin">管理員</SelectItem>
                  <SelectItem value="customer">用戶</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setShowInviteDialog(true)}>
              <Mail className="h-4 w-4 mr-2" />
              發送邀請
            </Button>
          </div>

          <div className="rounded-lg border bg-card shadow-soft">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用戶</TableHead>
                  <TableHead>系統角色</TableHead>
                  <TableHead>所屬店鋪</TableHead>
                  <TableHead>建立時間</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profilesLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filteredProfiles?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      沒有找到符合條件的用戶
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProfiles?.map((profile) => {
                    const roles = getUserRoles(profile.id);
                    const userStores = getUserStores(profile.id);
                    return (
                      <TableRow key={profile.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{profile.full_name || '未設定'}</div>
                            <div className="text-sm text-muted-foreground">{profile.email}</div>
                            {profile.phone && (
                              <div className="text-sm text-muted-foreground">{profile.phone}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {roles.map((role) => (
                              <span key={role}>{getRoleBadge(role)}</span>
                            ))}
                            {roles.length === 0 && (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {userStores.length === 0 ? (
                              <span className="text-muted-foreground text-sm">無</span>
                            ) : (
                              userStores.map((su: any) => (
                                <div key={su.id} className="flex items-center gap-2">
                                  <Store className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="text-sm">{su.store?.name}</span>
                                  {getStoreRoleBadge(su.role)}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-destructive ml-auto"
                                    onClick={() => removeStoreMutation.mutate(su.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(profile.created_at), 'yyyy/MM/dd')}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => openAssignDialog(profile.id)}>
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ==================== INVITATIONS TAB ==================== */}
        <TabsContent value="invitations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                待處理邀請
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invitations && invitations.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>店鋪</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>到期時間</TableHead>
                      <TableHead>邀請連結</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell>{inv.email}</TableCell>
                        <TableCell>
                          {inv.stores?.code ? `${inv.stores.code} - ${inv.stores.name}` : inv.stores?.name || '-'}
                        </TableCell>
                        <TableCell>{getStoreRoleBadge(inv.role)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(inv.expires_at), 'yyyy/MM/dd HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inv.token)}>
                            <Copy className="h-4 w-4 mr-1" />
                            複製連結
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">目前沒有待處理的邀請</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== STORE MEMBERS DIALOG ==================== */}
      <Dialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              {membersStore?.name} - 成員管理
            </DialogTitle>
            <DialogDescription>
              代碼：{membersStore?.code || '-'} ｜ 成員數：{membersStore?.store_users?.[0]?.count ?? 0}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {(() => {
              const members = membersStore ? getStoreMembers(membersStore.id) : [];
              return members.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">暫無成員</p>
              ) : (
                members.map((su: any) => {
                  const profile = profilesForStore?.find((p) => p.id === su.user_id);
                  return (
                    <div key={su.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{profile?.full_name || '未設定'}</div>
                        <div className="text-sm text-muted-foreground truncate">{profile?.email}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {getStoreRoleBadge(su.role)}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => {
                            removeStoreMutation.mutate(su.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              );
            })()}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowMembersDialog(false)}>
              關閉
            </Button>
            {membersStore && (
              <Button onClick={() => {
                setShowMembersDialog(false);
                setSelectedStoreId(membersStore.id);
                setShowAssignDialog(true);
              }}>
                <UserPlus className="h-4 w-4 mr-2" />
                新增成員
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== ASSIGN DIALOG ==================== */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派到店鋪</DialogTitle>
            <DialogDescription>
              將選定的使用者分配到特定店鋪，並設定其在該店鋪中的角色。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>店鋪</Label>
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇店鋪" />
                </SelectTrigger>
                <SelectContent>
                  {storesList?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.code ? `${store.code} - ${store.name}` : store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>角色</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="founder">創辦人</SelectItem>
                  <SelectItem value="manager">經理</SelectItem>
                  <SelectItem value="employee">員工</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>取消</Button>
            <Button onClick={() => assignMutation.mutate()} disabled={!selectedStoreId || assignMutation.isPending}>
              {assignMutation.isPending ? '處理中...' : '確認指派'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== INVITE DIALOG ==================== */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>發送邀請</DialogTitle>
            <DialogDescription>
              輸入 Email 以邀請新成員加入系統。您可以預先設定受邀者的所屬店鋪與權限。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="member@example.com" />
            </div>
            <div>
              <Label>店鋪</Label>
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger><SelectValue placeholder="選擇店鋪" /></SelectTrigger>
                <SelectContent>
                  {storesList?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.code ? `${store.code} - ${store.name}` : store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>角色</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="founder">創辦人</SelectItem>
                  <SelectItem value="manager">經理</SelectItem>
                  <SelectItem value="employee">員工</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>取消</Button>
            <Button onClick={() => inviteMutation.mutate()} disabled={!inviteEmail || !selectedStoreId || inviteMutation.isPending}>
              {inviteMutation.isPending ? '處理中...' : '發送邀請'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
