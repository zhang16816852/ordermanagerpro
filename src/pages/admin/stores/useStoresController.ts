import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from "@/hooks/useAuth";
import { useStoresQueries } from './useStoresQueries';
import { useStoresMutations } from './useStoresMutations';
import type { Store } from './storesTypes';

export function useStoresController() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // --- Shared state ---
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'stores');
  const [storeSearch, setStoreSearch] = useState('');
  const [userSearch, setUserSearch] = useState(searchParams.get('search') || '');
  const [storeFilter, setStoreFilter] = useState(searchParams.get('storeFilter') || 'all');
  const [roleFilter, setRoleFilter] = useState(searchParams.get('roleFilter') || 'all');

  // --- Store CRUD state ---
  const [isStoreDialogOpen, setIsStoreDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);

  // --- Store Members dialog ---
  const [showMembersDialog, setShowMembersDialog] = useState(false);
  const [membersStore, setMembersStore] = useState<any>(null);

  // --- User assignment state ---
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('employee');

  // --- Invite state ---
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  // --- System role (業務) state ---
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [roleUserId, setRoleUserId] = useState<string | null>(null);
  const [roleValue, setRoleValue] = useState<string>('customer');

  const {
    stores,
    storesLoading,
    profiles,
    profilesLoading,
    userRoles,
    storeUsers,
    storesList,
    invitations,
    profilesForStore,
  } = useStoresQueries();

  const {
    createStoreMutation,
    updateStoreMutation,
    assignMutation,
    removeStoreMutation,
    inviteMutation,
    systemRoleMutation,
  } = useStoresMutations({
    user,
    selectedUserId,
    selectedStoreId,
    selectedRole,
    inviteEmail,
    setIsStoreDialogOpen,
    setEditingStore,
    setShowAssignDialog,
    setSelectedUserId,
    setSelectedStoreId,
    setSelectedRole,
    setShowInviteDialog,
    setInviteEmail,
    setShowRoleDialog,
    setRoleUserId,
  });

  const openRoleDialog = (userId: string, roles: string[]) => {
    const current = roles.find((r) => r === 'rep') || roles.find((r) => r === 'admin') || roles.find((r) => r === 'fixengineer') || roles[0] || 'customer';
    setRoleUserId(userId);
    setRoleValue(current);
    setShowRoleDialog(true);
  };

  // ==================== HELPERS ====================

  const getUserRoles = (userId: string) =>
    userRoles?.filter((r) => r.user_id === userId).map((r) => r.role) || [];

  const getUserStores = (userId: string) =>
    storeUsers?.filter((s) => s.user_id === userId) || [];

  const getStoreMembers = (storeId: string) =>
    storeUsers?.filter((s) => s.store_id === storeId) || [];

  const getInviteLink = (token: string) =>
    `${window.location.origin}/invite/${token}`;

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(getInviteLink(token));
    toast.success('邀請連結已複製');
  };

  const openAssignDialog = (userId: string) => {
    setSelectedUserId(userId);
    setShowAssignDialog(true);
  };

  const openMembersDialog = (store: any) => {
    setMembersStore(store);
    setShowMembersDialog(true);
  };

  const handleStoreSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      code: (formData.get('code') as string) || null,
      brand: (formData.get('brand') as string) || null,
      address: (formData.get('address') as string) || null,
      phone: (formData.get('phone') as string) || null,
    };
    if (editingStore) {
      updateStoreMutation.mutate({ id: editingStore.id, ...data });
    } else {
      createStoreMutation.mutate(data as any);
    }
  };

  const filteredStores = stores?.filter(
    (s) =>
      s.name.toLowerCase().includes(storeSearch.toLowerCase()) ||
      s.code?.toLowerCase().includes(storeSearch.toLowerCase()),
  );

  const filteredProfiles = profiles?.filter((profile) => {
    const q = userSearch.toLowerCase();
    const matchesSearch =
      profile.email.toLowerCase().includes(q) ||
      profile.full_name?.toLowerCase().includes(q) ||
      profile.phone?.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (storeFilter !== 'all') {
      const userStores = getUserStores(profile.id);
      if (storeFilter === 'none') {
        if (userStores.length > 0) return false;
      } else {
        if (!userStores.some((s) => s.store_id === storeFilter)) return false;
      }
    }

    if (roleFilter !== 'all') {
      const roles = getUserRoles(profile.id);
      if (!roles.includes(roleFilter)) return false;
    }

    return true;
  });

  const onTabChange = (v: string) => {
    setActiveTab(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", v);
      return next;
    }, { replace: true });
  };

  const onStoreSearchChange = (v: string) => {
    setStoreSearch(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("search", v);
      else next.delete("search");
      return next;
    }, { replace: true });
  };

  const onUserSearchChange = (v: string) => {
    setUserSearch(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set("search", v);
      else next.delete("search");
      return next;
    }, { replace: true });
  };

  const onStoreFilterChange = (v: string) => {
    setStoreFilter(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("storeFilter", v);
      return next;
    }, { replace: true });
  };

  const onRoleFilterChange = (v: string) => {
    setRoleFilter(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("roleFilter", v);
      return next;
    }, { replace: true });
  };

  return {
    searchParams,
    setSearchParams,
    activeTab,
    setActiveTab,
    onTabChange,
    storeSearch,
    onStoreSearchChange,
    userSearch,
    onUserSearchChange,
    storeFilter,
    onStoreFilterChange,
    roleFilter,
    onRoleFilterChange,
    isStoreDialogOpen,
    setIsStoreDialogOpen,
    editingStore,
    setEditingStore,
    showMembersDialog,
    setShowMembersDialog,
    membersStore,
    setMembersStore,
    showAssignDialog,
    setShowAssignDialog,
    selectedUserId,
    setSelectedUserId,
    selectedStoreId,
    setSelectedStoreId,
    selectedRole,
    setSelectedRole,
    showInviteDialog,
    setShowInviteDialog,
    inviteEmail,
    setInviteEmail,
    showRoleDialog,
    setShowRoleDialog,
    roleUserId,
    setRoleUserId,
    roleValue,
    setRoleValue,
    stores,
    storesLoading,
    profiles,
    profilesLoading,
    storeUsers,
    storesList,
    invitations,
    profilesForStore,
    createStoreMutation,
    updateStoreMutation,
    assignMutation,
    removeStoreMutation,
    inviteMutation,
    systemRoleMutation,
    openRoleDialog,
    getUserRoles,
    getUserStores,
    getStoreMembers,
    getInviteLink,
    copyInviteLink,
    openAssignDialog,
    openMembersDialog,
    handleStoreSubmit,
    filteredStores,
    filteredProfiles,
  };
}

export type StoresController = ReturnType<typeof useStoresController>;