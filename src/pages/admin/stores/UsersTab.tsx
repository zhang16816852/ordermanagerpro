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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Store, Mail, X, UserCog, UserPlus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from "date-fns";
import { getRoleBadge, getStoreRoleBadge } from './storesBadges';
import type { StoresController } from './useStoresController';

export function UsersTab({ c }: { c: StoresController }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋用戶（Email、姓名、電話）..."
              value={c.userSearch}
              onChange={(e) => c.onUserSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={c.storeFilter} onValueChange={c.onStoreFilterChange}>
            <SelectTrigger className="w-[180px]">
              <Store className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="所有店鋪" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有店鋪</SelectItem>
              <SelectItem value="none">無所屬店鋪</SelectItem>
              {c.storesList?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code ? `${s.code} - ${s.name}` : s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={c.roleFilter} onValueChange={c.onRoleFilterChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="所有角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有角色</SelectItem>
              <SelectItem value="admin">管理員</SelectItem>
              <SelectItem value="rep">業務</SelectItem>
              <SelectItem value="fixengineer">維修人員</SelectItem>
              <SelectItem value="customer">用戶</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => c.setShowInviteDialog(true)}>
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
            {c.profilesLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : c.filteredProfiles?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  沒有找到符合條件的用戶
                </TableCell>
              </TableRow>
            ) : (
              c.filteredProfiles?.map((profile) => {
                const roles = c.getUserRoles(profile.id);
                const userStores = c.getUserStores(profile.id);
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
                                aria-label="移除門市"
                                onClick={() => c.removeStoreMutation.mutate(su.id)}
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
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label="系統角色" title="設定系統角色" onClick={() => c.openRoleDialog(profile.id, roles)}>
                          <UserCog className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="指派門市" onClick={() => c.openAssignDialog(profile.id)}>
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}