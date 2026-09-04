import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

// Separate types for system and store roles
type SystemRole = 'admin' | 'customer' | 'rep';
type StoreRoleType = 'founder' | 'manager' | 'employee';

interface StoreRole {
  store_id: string;
  store_name: string;
  role: StoreRoleType;
}

interface RepStore {
  store_id: string;
  store_name: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthReady: boolean;
  rolesReady: boolean;
  systemRoles: SystemRole[];
  storeRoles: StoreRole[];
  isAdmin: boolean;
  isRep: boolean;
  repAssignedStores: RepStore[];
  commissionRate: number;
  storeId: string | null;
  storeRole: StoreRoleType | null;
  setCurrentStore: (storeId: string | null) => void;
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
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [rolesReady, setRolesReady] = useState(false);
  const [systemRoles, setSystemRoles] = useState<SystemRole[]>([]);
  const [storeRoles, setStoreRoles] = useState<StoreRole[]>([]);
  const [repAssignedStores, setRepAssignedStores] = useState<RepStore[]>([]);
  const [commissionRate, setCommissionRate] = useState(0);
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);

  const isAdmin = systemRoles.includes('admin');
  const isRep = systemRoles.includes('rep');
  const storeRole = storeRoles.find(s => s.store_id === currentStoreId)?.role ?? null;

  const setCurrentStore = (storeId: string | null) => {
    setCurrentStoreId(storeId);
    if (storeId) {
      localStorage.setItem('currentStoreId', storeId);
    } else {
      localStorage.removeItem('currentStoreId');
    }
  };

  // Auto-select first store if none selected
  useEffect(() => {
    if (storeRoles.length > 0 && !currentStoreId) {
      const saved = localStorage.getItem('currentStoreId');
      if (saved && storeRoles.some(s => s.store_id === saved)) {
        setCurrentStoreId(saved);
      } else {
        setCurrentStoreId(storeRoles[0].store_id);
      }
    }
  }, [storeRoles, currentStoreId]);

  const fetchRoles = async (userId: string) => {
    try {
      // Fetch system roles
      const { data: roleData, error: roleError } = await (supabase
        .from('user_roles') as any)
        .select('role, commission_rate')
        .eq('user_id', userId);

      if (roleError) throw roleError;
      const roles = (roleData || []).map(r => r.role as SystemRole);
      setSystemRoles(roles);
      const repRow = (roleData || []).find(r => r.role === 'rep');
      setCommissionRate(repRow?.commission_rate ?? 0);

      // Fetch store roles
      const { data: storeData, error: storeError } = await (supabase
        .from('store_users') as any)
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

      // Fetch rep assigned stores
      if (roles.includes('rep')) {
        const { data: repData, error: repError } = await (supabase
          .from('rep_store_assignments') as any)
          .select(`
            store_id,
            stores (name)
          `)
          .eq('rep_id', userId);

        if (repError) throw repError;
        const repStores = (repData || []).map(s => ({
          store_id: s.store_id,
          store_name: (s.stores as any)?.name || '',
        }));
        setRepAssignedStores(repStores);
        // 自動選擇第一個已分配店家（業務專用）
        if (currentStoreId === null && repStores.length > 0) {
          setCurrentStoreId(repStores[0].store_id);
        }
      } else {
        setRepAssignedStores([]);
      }
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
          // Defer role fetching to avoid deadlock with getSession()
          setTimeout(async () => {
            await fetchRoles(session.user.id);
            setRolesReady(true);
            setLoading(false);
            setIsAuthReady(true);
          }, 0);
        } else {
          setSystemRoles([]);
          setStoreRoles([]);
          setRepAssignedStores([]);
          setCommissionRate(0);
          setRolesReady(true);
          setLoading(false);
          setIsAuthReady(true);
        }
      }
    );

    // Then check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await fetchRoles(session.user.id);
      }

      setRolesReady(true);
      setLoading(false);
      setIsAuthReady(true);
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
    setRepAssignedStores([]);
    setCommissionRate(0);
    toast.success('已登出');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isAuthReady,
        rolesReady,
        systemRoles,
        storeRoles,
        isAdmin,
        isRep,
        repAssignedStores,
        commissionRate,
        storeId: currentStoreId,
        storeRole,
        setCurrentStore,
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
