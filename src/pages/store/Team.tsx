import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Users, UserPlus, Mail, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

export default function StoreTeam() {
  const { user, storeId, storeRole } = useAuth();
  const queryClient = useQueryClient();
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("employee");

  const canManageTeam = storeRole === "founder" || storeRole === "manager";

  const { data: members, isLoading } = useQuery({
    queryKey: ["store-members", storeId],
    queryFn: async () => {
      if (!storeId) return [];

      const { data, error } = await supabase
        .from("store_users")
        .select(`
          id,
          role,
          created_at,
          user_id
        `)
        .eq("store_id", storeId);

      if (error) throw error;

      // Fetch profiles for members
      const userIds = data.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);

      return data.map((member) => ({
        ...member,
        profile: profiles?.find((p) => p.id === member.user_id),
      }));
    },
    enabled: !!storeId,
  });

  const { data: invitations } = useQuery({
    queryKey: ["store-invitations", storeId],
    queryFn: async () => {
      if (!storeId) return [];

      const { data, error } = await supabase
        .from("invitations")
        .select("*")
        .eq("store_id", storeId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!storeId && canManageTeam,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!storeId || !user) throw new Error("未登入或未選擇店鋪");

      const { error } = await supabase.from("invitations").insert({
        email: inviteEmail,
        store_id: storeId,
        role: inviteRole as "founder" | "manager" | "employee",
        invited_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("邀請已發送");
      setShowInviteDialog(false);
      setInviteEmail("");
      setInviteRole("employee");
      queryClient.invalidateQueries({ queryKey: ["store-invitations"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const getRoleBadge = (role: string) => {
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

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">請先選擇店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">團隊管理</h1>
          <p className="text-muted-foreground">管理店鋪成員</p>
        </div>
        {canManageTeam && (
          <Button onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            邀請成員
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            團隊成員
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>成員</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>加入時間</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {member.profile?.full_name || "未設定"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {member.profile?.email}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(member.role)}</TableCell>
                    <TableCell>
                      {format(new Date(member.created_at), "yyyy/MM/dd")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManageTeam && invitations && invitations.length > 0 && (
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
                  <TableHead>角色</TableHead>
                  <TableHead>到期時間</TableHead>
                  <TableHead>狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>{getRoleBadge(inv.role)}</TableCell>
                    <TableCell>
                      {format(new Date(inv.expires_at), "yyyy/MM/dd HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        等待中
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀請成員</DialogTitle>
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
              <Label>角色</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
              disabled={!inviteEmail || inviteMutation.isPending}
            >
              {inviteMutation.isPending ? "處理中..." : "發送邀請"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
