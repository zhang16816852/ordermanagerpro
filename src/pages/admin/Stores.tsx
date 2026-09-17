import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Store, Users, Mail } from 'lucide-react';
import { useStoresController } from './stores/useStoresController';
import { StoresTab } from './stores/StoresTab';
import { UsersTab } from './stores/UsersTab';
import { InvitationsTab } from './stores/InvitationsTab';
import { StoresDialogs } from './stores/StoresDialogs';

export default function AdminStores() {
  const c = useStoresController();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">店鋪管理</h1>
          <p className="text-muted-foreground">管理店鋪資訊與系統人員</p>
        </div>
      </div>

      <Tabs value={c.activeTab} onValueChange={c.onTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="stores" className="gap-2">
            <Store className="h-4 w-4" />
            店鋪管理
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            人員管理
          </TabsTrigger>
          {c.invitations && c.invitations.length > 0 && (
            <TabsTrigger value="invitations" className="gap-2 relative">
              <Mail className="h-4 w-4" />
              待處理邀請
              <Badge variant="destructive" className="ml-1 h-5 w-5 rounded-full p-0 text-[10px]">
                {c.invitations.length}
              </Badge>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="stores" className="space-y-4">
          <StoresTab c={c} />
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <UsersTab c={c} />
        </TabsContent>

        <TabsContent value="invitations" className="space-y-4">
          <InvitationsTab c={c} />
        </TabsContent>
      </Tabs>

      <StoresDialogs c={c} />
    </div>
  );
}