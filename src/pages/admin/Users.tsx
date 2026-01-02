import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, Users, Store, UserPlus, Mail, Clock, Trash2, Copy } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export default function AdminUsers() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("employee");
  const [inviteEmail, setInviteEmail] = useState("");

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (error) throw error;
      return data;
    },
  });

  const { data: storeUsers } = useQuery({
    queryKey: ["admin-store-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_users")
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

  const { data: stores } = useQuery({
    queryKey: ["admin-stores-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id, name, code")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: invitations } = useQuery({
    queryKey: ["admin-invitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select(`
          *,
          stores(name, code)
        `)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !selectedStoreId) throw new Error("請選擇用戶和店鋪");

      // Check if already exists
      const { data: existing } = await supabase
        .from("store_users")
        .select("id")
        .eq("user_id", selectedUserId)
        .eq("store_id", selectedStoreId)
        .single();

      if (existing) {
        // Update role
        const { error } = await supabase
          .from("store_users")
          .update({ role: selectedRole as "founder" | "manager" | "employee" })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from("store_users")
          .insert({
            user_id: selectedUserId,
            store_id: selectedStoreId,
            role: selectedRole as "founder" | "manager" | "employee",
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("已指派店鋪成員");
      setShowAssignDialog(false);
      setSelectedUserId(null);
      setSelectedStoreId("");
      setSelectedRole("employee");
      queryClient.invalidateQueries({ queryKey: ["admin-store-users"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!user || !selectedStoreId || !inviteEmail) throw new Error("請填寫完整資料");

      const { error } = await supabase.from("invitations").insert({
        email: inviteEmail,
        store_id: selectedStoreId,
        role: selectedRole as "founder" | "manager" | "employee",
        invited_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("邀請已發送");
      setShowInviteDialog(false);
      setInviteEmail("");
      setSelectedStoreId("");
      setSelectedRole("employee");
      queryClient.invalidateQueries({ queryKey: ["admin-invitations"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const removeStoreMutation = useMutation({
    mutationFn: async (storeUserId: string) => {
      const { error } = await supabase
        .from("store_users")
        .delete()
        .eq("id", storeUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已移除店鋪成員");
      queryClient.invalidateQueries({ queryKey: ["admin-store-users"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const getUserRoles = (userId: string) => {
    return userRoles?.filter((r) => r.user_id === userId).map((r) => r.role) || [];
  };

  const getUserStores = (userId: string) => {
    return storeUsers?.filter((s) => s.user_id === userId) || [];
  };

  const filteredProfiles = profiles?.filter((profile) => {
    const searchLower = search.toLowerCase();
    return (
      profile.email.toLowerCase().includes(searchLower) ||
      profile.full_name?.toLowerCase().includes(searchLower) ||
      profile.phone?.toLowerCase().includes(searchLower)
    );
  });

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return <Badge className="bg-red-500">管理員</Badge>;
      case "customer":
        return <Badge variant="secondary">用戶</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getStoreRoleBadge = (role: string) => {
    switch (role) {
      case "founder":
        return <Badge className="bg-purple-500">創辦人</Badge>;
      case "manager":
        return <Badge className="bg-blue-500">經理</Badge>;
      case "employee":
        return <Badge variant="secondary">員工</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getInviteLink = (token: string) => {
    return `${window.location.origin}/invite/${token}`;
  };

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(getInviteLink(token));
    toast.success("邀請連結已複製");
  };

  const openAssignDialog = (userId: string) => {
    setSelectedUserId(userId);
    setShowAssignDialog(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">人員管理</h1>
          <p className="text-muted-foreground">管理系統中的所有用戶</p>
        </div>
        <Button onClick={() => setShowInviteDialog(true)}>
          <Mail className="h-4 w-4 mr-2" />
          發送邀請
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            用戶列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋用戶（Email、姓名、電話）..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : (
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
                {filteredProfiles?.map((profile) => {
                  const roles = getUserRoles(profile.id);
                  const userStores = getUserStores(profile.id);

                  return (
                    <TableRow key={profile.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {profile.full_name || "未設定"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {profile.email}
                          </div>
                          {profile.phone && (
                            <div className="text-sm text-muted-foreground">
                              {profile.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {roles.map((role) => (
                            <span key={role}>{getRoleBadge(role)}</span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {userStores.length === 0 ? (
                            <span className="text-muted-foreground text-sm">無</span>
                          ) : (
                            userStores.map((su: any) => (
                              <div key={su.id} className="flex items-center gap-2">
                                <Store className="h-3 w-3 text-muted-foreground" />
                                <span className="text-sm">{su.store?.name}</span>
                                {getStoreRoleBadge(su.role)}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-destructive"
                                  onClick={() => removeStoreMutation.mutate(su.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(new Date(profile.created_at), "yyyy/MM/dd")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openAssignDialog(profile.id)}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {invitations && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              待處理邀請
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      {inv.stores?.code
                        ? `${inv.stores.code} - ${inv.stores.name}`
                        : inv.stores?.name || "-"}
                    </TableCell>
                    <TableCell>{getStoreRoleBadge(inv.role)}</TableCell>
                    <TableCell>
                      {format(new Date(inv.expires_at), "yyyy/MM/dd HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyInviteLink(inv.token)}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        複製連結
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Assign to Store Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派到店鋪</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>店鋪</Label>
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇店鋪" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.map((store) => (
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="founder">創辦人</SelectItem>
                  <SelectItem value="manager">經理</SelectItem>
                  <SelectItem value="employee">員工</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => assignMutation.mutate()}
              disabled={!selectedStoreId || assignMutation.isPending}
            >
              {assignMutation.isPending ? "處理中..." : "確認指派"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>發送邀請</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="member@example.com"
              />
            </div>
            <div>
              <Label>店鋪</Label>
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇店鋪" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.map((store) => (
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="founder">創辦人</SelectItem>
                  <SelectItem value="manager">經理</SelectItem>
                  <SelectItem value="employee">員工</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              disabled={!inviteEmail || !selectedStoreId || inviteMutation.isPending}
            >
              {inviteMutation.isPending ? "處理中..." : "發送邀請"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
