import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Copy } from 'lucide-react';
import { format } from "date-fns";
import { getStoreRoleBadge } from './storesBadges';
import type { StoresController } from './useStoresController';

export function InvitationsTab({ c }: { c: StoresController }) {
  const { invitations, copyInviteLink } = c;
  return (
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
  );
}