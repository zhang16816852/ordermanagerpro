import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, CheckCircle, XCircle, Store, UserPlus, Mail, Lock, User } from 'lucide-react';
import { z } from 'zod';

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

const signUpSchema = z.object({
  fullName: z.string().min(2, '姓名至少需要 2 個字元'),
  password: z.string().min(6, '密碼至少需要 6 個字元'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: '密碼不一致',
  path: ['confirmPassword'],
});

const AcceptInvite = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, signUp } = useAuth();
  
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 註冊表單狀態
  const [showSignUp, setShowSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [registering, setRegistering] = useState(false);

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

  // 註冊並自動綁定角色和店鋪
  const handleSignUpAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    if (!invitation || !invitation.store) return;

    try {
      signUpSchema.parse({ fullName, password, confirmPassword });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach(e => {
          fieldErrors[e.path[0]] = e.message;
        });
        setFormErrors(fieldErrors);
        return;
      }
    }

    setRegistering(true);

    try {
      // 1. 註冊用戶
      const { error: signUpError, data: authData } = await supabase.auth.signUp({
        email: invitation.email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            full_name: fullName,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          toast.error('此 Email 已經註冊過，請直接登入');
          setShowSignUp(false);
        } else {
          toast.error(signUpError.message);
        }
        setRegistering(false);
        return;
      }

      if (!authData.user) {
        toast.error('註冊失敗，請稍後再試');
        setRegistering(false);
        return;
      }

      // 2. 添加用戶到 store_users
      const { error: insertError } = await supabase
        .from('store_users')
        .insert({
          store_id: invitation.store.id,
          user_id: authData.user.id,
          role: invitation.role as 'founder' | 'manager' | 'employee',
        });

      if (insertError) {
        console.error('Failed to add store user:', insertError);
        // 即使失敗也繼續，因為用戶已經創建
      }

      // 3. 更新邀請狀態
      const { error: updateError } = await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      if (updateError) {
        console.error('Failed to update invitation status:', updateError);
      }

      toast.success('註冊成功！已加入店鋪');
      navigate('/store/dashboard');
    } catch (err) {
      console.error('Registration error:', err);
      toast.error('註冊失敗，請稍後再試');
    } finally {
      setRegistering(false);
    }
  };

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

  // 用戶未登入 - 顯示註冊表單
  if (!user) {
    if (showSignUp) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <UserPlus className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>註冊並加入店鋪</CardTitle>
              <CardDescription>
                填寫資料完成註冊，即可加入 {invitation.store.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSignUpAndAccept} className="space-y-4">
                <div className="rounded-lg border p-3 bg-muted/50">
                  <p className="text-sm text-muted-foreground">邀請 Email</p>
                  <p className="font-medium">{invitation.email}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName">姓名</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="您的姓名"
                      className="pl-10"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  {formErrors.fullName && <p className="text-sm text-destructive">{formErrors.fullName}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">密碼</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="至少 6 個字元"
                      className="pl-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {formErrors.password && <p className="text-sm text-destructive">{formErrors.password}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">確認密碼</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="再次輸入密碼"
                      className="pl-10"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  {formErrors.confirmPassword && <p className="text-sm text-destructive">{formErrors.confirmPassword}</p>}
                </div>

                <div className="rounded-lg border p-3 bg-muted/30">
                  <div className="flex items-center gap-2 text-sm">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">將加入店鋪：</span>
                    <span className="font-medium">{invitation.store.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mt-1">
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">職位：</span>
                    <span className="font-medium">{getRoleLabel(invitation.role)}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    type="button"
                    variant="outline" 
                    className="flex-1"
                    onClick={() => setShowSignUp(false)}
                  >
                    返回
                  </Button>
                  <Button type="submit" className="flex-1" disabled={registering}>
                    {registering ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        註冊中...
                      </>
                    ) : (
                      '註冊並加入'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      );
    }

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
              請選擇登入或註冊帳號以接受邀請
            </p>
            <div className="flex flex-col gap-2">
              <Button 
                className="w-full" 
                onClick={() => setShowSignUp(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                註冊新帳號
              </Button>
              <Button 
                variant="outline"
                className="w-full" 
                onClick={() => navigate(`/auth?redirect=/invite/${token}`)}
              >
                已有帳號，登入
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
