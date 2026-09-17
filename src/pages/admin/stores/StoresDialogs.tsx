import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { StorePicker } from '@/components/ui/StorePicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Store, UserPlus, Trash2 } from 'lucide-react';
import { getStoreRoleBadge } from './storesBadges';
import type { StoresController } from './useStoresController';

export function StoresDialogs({ c }: { c: StoresController }) {
  const {
    showMembersDialog, setShowMembersDialog, membersStore,
    getStoreMembers, profilesForStore, removeStoreMutation,
    setSelectedStoreId, setShowAssignDialog,
    showAssignDialog, selectedStoreId,
    selectedRole, setSelectedRole, assignMutation,
    showInviteDialog, setShowInviteDialog, inviteEmail, setInviteEmail,
    inviteMutation, storesList,
    showRoleDialog, setShowRoleDialog, roleUserId, setRoleUserId,
    roleValue, setRoleValue, profiles, systemRoleMutation,
  } = c;

  return (
    <>
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
                          aria-label="移除門市成員"
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
              <Label htmlFor="assign-store">店鋪</Label>
              <StorePicker
                stores={storesList || []}
                value={selectedStoreId}
                onChange={(v) => setSelectedStoreId(Array.isArray(v) ? v[0] : v)}
                placeholder="選擇店鋪"
                searchPlaceholder="搜尋店鋪..."
                notFoundText="找不到符合的店鋪"
              />
            </div>
            <div>
              <Label htmlFor="assign-role">角色</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger id="assign-role"><SelectValue /></SelectTrigger>
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
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="member@example.com" />
            </div>
            <div>
              <Label htmlFor="invite-store">店鋪</Label>
              <StorePicker
                stores={storesList || []}
                value={selectedStoreId}
                onChange={(v) => setSelectedStoreId(Array.isArray(v) ? v[0] : v)}
                placeholder="選擇店鋪"
                searchPlaceholder="搜尋店鋪..."
                notFoundText="找不到符合的店鋪"
              />
            </div>
            <div>
              <Label htmlFor="invite-role">角色</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
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

      {/* ==================== SYSTEM ROLE DIALOG ==================== */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設定系統角色</DialogTitle>
            <DialogDescription>
              設定使用者的系統身分。選擇「業務」即授予業務身分（跨店、名下店家由業務管理頁分配）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="role-user">用戶</Label>
              <div className="text-sm font-medium">
                {roleUserId ? profiles?.find((p) => p.id === roleUserId)?.full_name || '未設定' : '—'}
              </div>
            </div>
            <div>
              <Label htmlFor="role-value">系統角色</Label>
              <Select value={roleValue} onValueChange={setRoleValue}>
                <SelectTrigger id="role-value"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rep">業務</SelectItem>
                  <SelectItem value="admin">管理員</SelectItem>
                  <SelectItem value="fixengineer">維修人員</SelectItem>
                  <SelectItem value="customer">用戶</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleDialog(false)}>取消</Button>
            <Button
              onClick={() => {
                if (!roleUserId) return;
                systemRoleMutation.mutate({ userId: roleUserId, role: roleValue });
              }}
              disabled={!roleUserId || systemRoleMutation.isPending}
            >
              {systemRoleMutation.isPending ? '儲存中...' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}