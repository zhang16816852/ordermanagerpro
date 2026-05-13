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
  is_pre_created: boolean;
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
  const { user, loading: authLoading, signUp, refreshRoles } = useAuth();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表單狀態
  // showSignUp: 控制是否顯示密碼設定表單
  // 若 is_pre_created=true 則在邀請載入後自動設為 true
  // 若 is_pre_created=false (已有真實帳號) 則維持 false，引導登入
  const [showSignUp, setShowSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [registering, setRegistering] = useState(false);
  // 是否為「已有真實帳號」的使用者（非預建帳號）
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);

  useEffect(() => {
    console.log({
      authLoading,
      user,
      token
    });
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
            is_pre_created,
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
        console.log('invite data', data);

        const inviteData = data as InvitationDetails;
        setInvitation(inviteData);

        // 根據 is_pre_created 決定初始 UI 狀態
        if (inviteData.is_pre_created === true) {
          // 系統預建帳號（新流程）：直接顯示設定密碼表單
          setShowSignUp(true);
        } else if (inviteData.is_pre_created === false) {
          // 帳號已經存在，直接顯示登入提示畫面，不顯示註冊選項
          setIsAlreadyRegistered(true);
        }
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
      if (invitation.is_pre_created) {
        // 如果是預建帳號，使用 Edge Function 領取
        const { data, error } = await supabase.functions.invoke('invitation-service', {
          body: {
            action: 'claim',
            token: token,
            password: password,
            fullName: fullName,
          }
        });

        if (error || data.error) {
          throw new Error(error?.message || data.error);
        }

        toast.success('帳號已啟用！已加入店鋪');
      } else {
        // 舊系統邀請流程：直接使用 Supabase Auth 註冊
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
          // Email 已被使用 → 引導登入
          if (
            signUpError.message.toLowerCase().includes('already registered') ||
            signUpError.message.toLowerCase().includes('user already registered') ||
            signUpError.status === 422
          ) {
            toast.error('此 Email 已有帳號，請直接登入以接受邀請');
            setShowSignUp(false); // 回到選擇畫面
            setIsAlreadyRegistered(true); // 顯示「登入」UI
          } else {
            toast.error(signUpError.message);
          }
          setRegistering(false);
          return;
        }

        // Supabase 有時回傳 user 但沒有 id（Email 已被使用的情況）
        if (!authData.user || !authData.user.id) {
          toast.error('此 Email 已有帳號，請直接登入以接受邀請');
          setShowSignUp(false);
          setIsAlreadyRegistered(true);
          setRegistering(false);
          return;
        }

        // 更新邀請狀態為已接受 (透過 RPC 迴避 RLS 限制)
        const { error: rpcUpdateError } = await supabase.rpc('accept_invitation', {
          p_invitation_id: invitation.id
        });
        
        if (rpcUpdateError) {
          console.error('RPC failed to update invitation status:', rpcUpdateError);
          // Fallback
          await supabase
            .from('invitations')
            .update({ status: 'accepted' })
            .eq('id', invitation.id);
        }

        toast.success('註冊成功！');
      }

      // 自動登入（取得完整 Session 後再綁定店鋪）
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: invitation.email,
        password: password,
      });

      if (signInError || !signInData.user) {
        toast.error('自動登入失敗，請手動登入');
        navigate('/auth');
        return;
      }

      // 登入成功後，以完整 Session 將用戶綁定到店鋪
      const { error: insertError } = await supabase
        .from('store_users')
        .insert({
          store_id: invitation.store?.id,
          user_id: signInData.user.id,
          role: invitation.role as 'founder' | 'manager' | 'employee',
        });

      if (insertError && insertError.code !== '23505') {
        console.error('綁定店鋪失敗:', insertError);
        // 嘗試透過 RPC 以系統權限綁定
        const { error: rpcError } = await supabase.rpc('bind_user_to_store', {
          p_store_id: invitation.store?.id,
          p_user_id: signInData.user.id,
          p_role: invitation.role,
        });
        if (rpcError) {
          console.error('RPC 綁定也失敗:', rpcError);
          toast.error('加入店鋪失敗，請聯繫管理員');
        }
      }

      // 刷新角色資料，確保 auth context 即時更新
      await refreshRoles();
      toast.success('已成功加入店鋪！');

      navigate('/dashboard');
    } catch (err: any) {
      console.error('Registration/Claim error:', err);
      toast.error(err.message || '操作失敗，請稍後再試');
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

      // Update invitation status to accepted (透過 RPC 迴避 RLS 限制)
      const { error: rpcUpdateError } = await supabase.rpc('accept_invitation', {
        p_invitation_id: invitation.id
      });

      if (rpcUpdateError) {
        console.error('Failed to update invitation status via RPC:', rpcUpdateError);
        // Fallback
        const { error: updateError } = await supabase
          .from('invitations')
          .update({ status: 'accepted' })
          .eq('id', invitation.id);
        if (updateError) {
          console.error('Failed to update invitation status:', updateError);
        }
      }

      toast.success('成功加入店鋪！');
      // 刷新角色資料後再跳轉
      await refreshRoles();
      navigate('/dashboard');
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

  if (loading) {
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

  // 如果載入完成但沒有邀請資訊，且沒有錯誤，則顯示無效邀請
  if (!loading && !error && (!invitation || !invitation.store)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>邀請無效</CardTitle>
            <CardDescription>找不到相關的邀請資訊或商店資訊。</CardDescription>
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

  // 用戶未登入 - 根據 is_pre_created 決定顯示哪種 UI
  if (!user) {
    // 情況 A0：用戶嘗試以已有帳號 Email 註冊失敗後，引導登入
    if (isAlreadyRegistered) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Store className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>此 Email 已有帳號</CardTitle>
              <CardDescription>
                {invitation?.store?.name} 邀請您以 {getRoleLabel(invitation?.role || '')} 身份加入
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4 bg-muted/50">
                <p className="text-sm text-muted-foreground">邀請 Email</p>
                <p className="font-medium">{invitation?.email}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-700">
                  此 Email 已有帳號，請直接登入以接受邀請。
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => navigate(`/auth?redirect=/invite/${token}`)}
              >
                <Mail className="mr-2 h-4 w-4" />
                登入帳號以接受邀請
              </Button>
              <Button
                variant="ghost"
                className="w-full text-sm"
                onClick={() => setIsAlreadyRegistered(false)}
              >
                返回
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    // 情況 A：系統預建帳號（is_pre_created=true），直接顯示設定密碼表單
    if (showSignUp) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <UserPlus className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>設定您的帳號</CardTitle>
              <CardDescription>
                填寫姓名與密碼，即可加入 {invitation.store?.name}
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
                  <Label htmlFor="password">設定密碼</Label>
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
                    <span className="font-medium">{invitation.store?.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mt-1">
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">職位：</span>
                    <span className="font-medium">{getRoleLabel(invitation.role)}</span>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={registering}>
                  {registering ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      處理中...
                    </>
                  ) : (
                    '確認並加入店鋪'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      );
    }

    // 情況 B2：舊系統邀請（is_pre_created=false/null）
    // 讓用戶選擇「註冊新帳號」或「已有帳號登入」
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>您已被邀請加入店鋪</CardTitle>
            <CardDescription>
              {invitation?.store?.name} 邀請您以 {getRoleLabel(invitation?.role || '')} 身份加入
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <p className="text-sm text-muted-foreground">邀請 Email</p>
              <p className="font-medium">{invitation?.email}</p>
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
                <Mail className="mr-2 h-4 w-4" />
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
