import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Users, Shield, Store } from "lucide-react";
import { format } from "date-fns";

export default function AdminUsers() {
  const [search, setSearch] = useState("");

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
          user_id,
          role,
          store:stores(name, code)
        `);
      if (error) throw error;
      return data;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">人員管理</h1>
        <p className="text-muted-foreground">管理系統中的所有用戶</p>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProfiles?.map((profile) => {
                  const roles = getUserRoles(profile.id);
                  const stores = getUserStores(profile.id);

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
                          {stores.length === 0 ? (
                            <span className="text-muted-foreground text-sm">無</span>
                          ) : (
                            stores.map((su: any, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <Store className="h-3 w-3 text-muted-foreground" />
                                <span className="text-sm">{su.store?.name}</span>
                                {getStoreRoleBadge(su.role)}
                              </div>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(new Date(profile.created_at), "yyyy/MM/dd")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
