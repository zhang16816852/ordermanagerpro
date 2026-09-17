import { Badge } from '@/components/ui/badge';

export function getRoleBadge(role: string) {
  switch (role) {
    case 'admin': return <Badge className="bg-red-500">管理員</Badge>;
    case 'customer': return <Badge variant="secondary">用戶</Badge>;
    case 'rep': return <Badge className="bg-emerald-600">業務</Badge>;
    case 'fixengineer': return <Badge className="bg-amber-600">維修人員</Badge>;
    default: return <Badge variant="outline">{role}</Badge>;
  }
}

export function getStoreRoleBadge(role: string) {
  switch (role) {
    case 'founder': return <Badge className="bg-purple-500">創辦人</Badge>;
    case 'manager': return <Badge className="bg-blue-500">經理</Badge>;
    case 'employee': return <Badge variant="secondary">員工</Badge>;
    default: return <Badge variant="outline">{role}</Badge>;
  }
}