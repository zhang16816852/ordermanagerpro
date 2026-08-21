import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Loader2, Mail, Lock, User } from 'lucide-react';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('請輸入有效的電子信箱'),
  password: z.string().min(6, '密碼至少需要 6 個字元'),
});

const signUpSchema = loginSchema.extend({
  fullName: z.string().min(2, '姓名至少需要 2 個字元'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: '密碼不一致',
  path: ['confirmPassword'],
});

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, signIn, signUp, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup form
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');

  // Check for invitation token and redirect
  const inviteToken = searchParams.get('invite');
  const redirectUrl = searchParams.get('redirect') || '/';
  /*email 後墜輔助輸入區域 */

  //email 後墜輔助清單
  const emailDomains = [
    "gmail.com",
    "icloud.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
  ];
  //監控變化
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const handleEmailChange = (value: string) => {
    setLoginEmail(value);
    setSelectedIndex(-1);

    const atIndex = value.indexOf("@");

    if (atIndex === -1) {
      setShowSuggestions(false);
      return;
    }

    const prefix = value.slice(0, atIndex);
    const domainPart = value.slice(atIndex + 1);

    const filtered = emailDomains.filter(domain =>
      domain.startsWith(domainPart)
    );

    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
  };
  const selectDomain = (domain: string) => {
    const prefix = loginEmail.split("@")[0];
    setLoginEmail(`${prefix}@${domain}`);
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case 'Enter':
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          e.preventDefault();
          selectDomain(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  useEffect(() => {
    if (inviteToken) {
      setActiveTab('signup');
    }
  }, [inviteToken]);

  useEffect(() => {
    if (user && !authLoading) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, navigate, redirectUrl]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      loginSchema.parse({ email: loginEmail, password: loginPassword });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach(e => {
          fieldErrors[e.path[0]] = e.message;
        });
        setErrors(fieldErrors);
        return;
      }
    }

    setLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setLoading(false);

    if (!error) {
      navigate('/', { replace: true });
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      signUpSchema.parse({
        email: signupEmail,
        password: signupPassword,
        confirmPassword,
        fullName,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach(e => {
          fieldErrors[e.path[0]] = e.message;
        });
        setErrors(fieldErrors);
        return;
      }
    }

    setLoading(true);
    const { error } = await signUp(signupEmail, signupPassword, fullName);
    setLoading(false);

    if (!error) {
      navigate('/', { replace: true });
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 shadow-glow">
            <Package className="h-8 w-8 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">訂單處理系統</h1>
          <p className="text-muted-foreground mt-1">高效管理您的店鋪訂單</p>
        </div>

        <Card className="shadow-soft">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl text-center">
              {activeTab === 'login' ? '登入帳號' : '建立帳號'}
            </CardTitle>
            <CardDescription className="text-center">
              {activeTab === 'login'
                ? '輸入您的帳號密碼登入系統'
                : inviteToken
                  ? '您收到了邀請，請填寫資料完成註冊'
                  : '註冊新帳號以開始使用系統'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'login' | 'signup')}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login">登入</TabsTrigger>
                <TabsTrigger value="signup">註冊</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2 relative">
                    <Label htmlFor="login-email">電子信箱</Label>

                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="your@email.com"
                        className="pl-10"
                        value={loginEmail}
                        onChange={(e) => handleEmailChange(e.target.value)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                        onFocus={() => loginEmail.includes("@") && setShowSuggestions(true)}
                        onKeyDown={handleEmailKeyDown}
                        role="combobox"
                        aria-expanded={showSuggestions && suggestions.length > 0}
                        aria-controls="email-suggestions-listbox"
                        aria-autocomplete="list"
                        aria-activedescendant={selectedIndex >= 0 ? `email-suggestion-${selectedIndex}` : undefined}
                      />
                    </div>

                    {showSuggestions && (
                      <div
                        id="email-suggestions-listbox"
                        role="listbox"
                        className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow"
                      >
                        {suggestions.map((domain, index) => (
                          <button
                            key={domain}
                            id={`email-suggestion-${index}`}
                            type="button"
                            role="option"
                            aria-selected={index === selectedIndex}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-muted${index === selectedIndex ? ' bg-muted' : ''}`}
                            onMouseDown={() => selectDomain(domain)}
                            onMouseEnter={() => setSelectedIndex(index)}
                          >
                            {loginEmail.split("@")[0]}@{domain}
                          </button>
                        ))}
                      </div>
                    )}

                    {errors.email && (
                      <p className="text-sm text-destructive">{errors.email}</p>
                    )}
                  </div>


                  <div className="space-y-2">
                    <Label htmlFor="login-password">密碼</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="••••••••"
                        className="pl-10"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                      />
                    </div>
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    登入
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">姓名</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="signup-name"
                        type="text"
                        placeholder="您的姓名"
                        className="pl-10"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    {errors.fullName && <p className="text-sm text-destructive">{errors.fullName}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">電子信箱</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="your@email.com"
                        className="pl-10"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                      />
                    </div>
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">密碼</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="至少 6 個字元"
                        className="pl-10"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                      />
                    </div>
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">確認密碼</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="confirm-password"
                        type="password"
                        placeholder="再次輸入密碼"
                        className="pl-10"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                    {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    註冊
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    自行註冊的帳號為基本會員，僅可查看零售價格
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
