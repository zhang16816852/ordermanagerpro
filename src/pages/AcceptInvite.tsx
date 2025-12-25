import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, CheckCircle, XCircle, Store, UserPlus } from 'lucide-react';

interface InvitationDetails {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  store: {
    id: string;
    name: string;
  } | null;
}

const AcceptInvite = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInvitation = async () => {
      if (!token) {
        setError('無效的邀請連結');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('invitations')
          .select(`
            id,
            email,
            role,
            status,
            expires_at,
            store:stores(id, name)
          `)
          .eq('token', token)
          .single();

        if (fetchError || !data) {
          setError('邀請不存在或已失效');
          setLoading(false);
          return;
        }

        // Check if invitation is still pending
        if (data.status !== 'pending') {
          setError('此邀請已被接受或已過期');
          setLoading(false);
          return;
        }

        // Check if invitation has expired
        if (new Date(data.expires_at) < new Date()) {
          setError('此邀請已過期');
          setLoading(false);
          return;
        }

        setInvitation(data as InvitationDetails);
      } catch (err) {
        setError('無法載入邀請資訊');
      } finally {
        setLoading(false);
      }
    };

    fetchInvitation();
  }, [token]);

  const handleAcceptInvitation = async () => {
    if (!user || !invitation || !invitation.store) return;

    // Verify user email matches invitation email
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      toast.error('您的帳號 Email 與邀請 Email 不符');
      return;
    }

    setAccepting(true);

    try {
      // Add user to store_users
      const { error: insertError } = await supabase
        .from('store_users')
        .insert({
          store_id: invitation.store.id,
          user_id: user.id,
          role: invitation.role as 'founder' | 'manager' | 'employee',
        });

      if (insertError) {
        if (insertError.code === '23505') {
          toast.error('您已經是此店鋪的成員');
        } else {
          throw insertError;
        }
        setAccepting(false);
        return;
      }

      // Update invitation status to accepted
      const { error: updateError } = await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      if (updateError) {
        console.error('Failed to update invitation status:', updateError);
      }

      toast.success('成功加入店鋪！');
      navigate('/store/dashboard');
    } catch (err) {
      console.error('Accept invitation error:', err);
      toast.error('接受邀請失敗，請稍後再試');
    } finally {
      setAccepting(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      founder: '創辦人',
      manager: '經理',
      employee: '員工',
    };
    return labels[role] || role;
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>邀請無效</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => navigate('/')} variant="outline">
              返回首頁
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!invitation || !invitation.store) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>載入中...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // User not logged in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>您已被邀請加入店鋪</CardTitle>
            <CardDescription>
              {invitation.store.name} 邀請您以 {getRoleLabel(invitation.role)} 身份加入
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <p className="text-sm text-muted-foreground">邀請 Email</p>
              <p className="font-medium">{invitation.email}</p>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              請先登入或註冊帳號以接受邀請
            </p>
            <div className="flex gap-2">
              <Button 
                className="flex-1" 
                onClick={() => navigate(`/auth?redirect=/invite/${token}`)}
              >
                登入 / 註冊
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User logged in but email doesn't match
  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
              <XCircle className="h-6 w-6 text-warning" />
            </div>
            <CardTitle>Email 不符</CardTitle>
            <CardDescription>
              此邀請是發送給 {invitation.email}，但您目前登入的帳號是 {user.email}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              請使用正確的帳號登入，或請管理員重新發送邀請到您目前的 Email
            </p>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => navigate('/')}
              >
                返回首頁
              </Button>
              <Button 
                className="flex-1"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate(`/auth?redirect=/invite/${token}`);
                }}
              >
                切換帳號
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User logged in and email matches
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>接受邀請</CardTitle>
          <CardDescription>
            您已被邀請加入 {invitation.store.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">店鋪名稱</p>
              <p className="font-medium">{invitation.store.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">職位</p>
              <p className="font-medium">{getRoleLabel(invitation.role)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">您的帳號</p>
              <p className="font-medium">{user.email}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => navigate('/')}
            >
              取消
            </Button>
            <Button 
              className="flex-1"
              onClick={handleAcceptInvitation}
              disabled={accepting}
            >
              {accepting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  處理中...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  接受邀請
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AcceptInvite;
