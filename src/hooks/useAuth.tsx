import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Separate types for system and store roles
type SystemRole = 'admin' | 'customer';
type StoreRoleType = 'founder' | 'manager' | 'employee';

interface StoreRole {
  store_id: string;
  store_name: string;
  role: StoreRoleType;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  systemRoles: SystemRole[];
  storeRoles: StoreRole[];
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemRoles, setSystemRoles] = useState<SystemRole[]>([]);
  const [storeRoles, setStoreRoles] = useState<StoreRole[]>([]);

  const isAdmin = systemRoles.includes('admin');

  const fetchRoles = async (userId: string) => {
    try {
      // Fetch system roles
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (roleError) throw roleError;
      setSystemRoles((roleData || []).map(r => r.role as SystemRole));

      // Fetch store roles
      const { data: storeData, error: storeError } = await supabase
        .from('store_users')
        .select(`
          store_id,
          role,
          stores (name)
        `)
        .eq('user_id', userId);

      if (storeError) throw storeError;
      setStoreRoles(
        (storeData || []).map(s => ({
          store_id: s.store_id,
          store_name: (s.stores as any)?.name || '',
          role: s.role as StoreRoleType,
        }))
      );
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const refreshRoles = async () => {
    if (user) {
      await fetchRoles(user.id);
    }
  };

  useEffect(() => {
    // Set up auth state listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Defer role fetching to avoid deadlock
          setTimeout(() => {
            fetchRoles(session.user.id);
          }, 0);
        } else {
          setSystemRoles([]);
          setStoreRoles([]);
        }
        
        setLoading(false);
      }
    );

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchRoles(session.user.id);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        toast.error(getAuthErrorMessage(error.message));
        return { error };
      }
      
      toast.success('登入成功');
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
          },
        },
      });
      
      if (error) {
        toast.error(getAuthErrorMessage(error.message));
        return { error };
      }
      
      toast.success('註冊成功！');
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSystemRoles([]);
    setStoreRoles([]);
    toast.success('已登出');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        systemRoles,
        storeRoles,
        isAdmin,
        signIn,
        signUp,
        signOut,
        refreshRoles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

function getAuthErrorMessage(message: string): string {
  const errorMap: Record<string, string> = {
    'Invalid login credentials': '帳號或密碼錯誤',
    'User already registered': '此信箱已註冊',
    'Email not confirmed': '請先驗證您的信箱',
    'Password should be at least 6 characters': '密碼至少需要 6 個字元',
    'Invalid email': '請輸入有效的電子信箱',
  };
  
  return errorMap[message] || message;
}
