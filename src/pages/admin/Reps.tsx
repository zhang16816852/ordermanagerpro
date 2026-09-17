import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserCog, Store as StoreIcon, Percent } from 'lucide-react';
import { useRepsController } from './useRepsController';
import { RepsListTab } from './reps/RepsListTab';
import { StoreAssignmentTab } from './reps/StoreAssignmentTab';
import { CostSettingsTab } from './reps/CostSettingsTab';
import { CommissionDialog } from './reps/CommissionDialog';

export default function AdminReps() {
  const c = useRepsController();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">業務管理</h1>
          <p className="text-muted-foreground">管理業務身分、店家分配與成本/佣金設定</p>
        </div>
      </div>

      <Tabs value={c.activeTab} onValueChange={(v) => {
        c.setActiveTab(v);
        c.setSearchParams({ tab: v }, { replace: true });
      }}>
        <TabsList>
          <TabsTrigger value="reps" className="gap-1.5"><UserCog className="h-4 w-4" />業務列表</TabsTrigger>
          <TabsTrigger value="assign" className="gap-1.5"><StoreIcon className="h-4 w-4" />店家分配</TabsTrigger>
          <TabsTrigger value="costs" className="gap-1.5"><Percent className="h-4 w-4" />成本設定</TabsTrigger>
        </TabsList>

        <TabsContent value="reps" className="mt-4">
          <RepsListTab
            filteredReps={c.filteredReps}
            repsLoading={c.repsLoading}
            profileOf={c.profileOf}
            assignmentCount={(userId) => c.assignmentStores(userId).length}
            repCommissionSummary={c.repCommissionSummary}
            repSearch={c.repSearch}
            setRepSearch={c.setRepSearch}
            onEditCommission={c.openCommission}
            onViewCommission={(userId) => c.navigate(`/admin/reps/${userId}/commission`)}
          />
        </TabsContent>

        <TabsContent value="assign" className="mt-4">
          <StoreAssignmentTab
            filteredAssignReps={c.filteredAssignReps}
            reps={c.reps}
            profileOf={c.profileOf}
            stores={c.stores}
            assignmentStores={c.assignmentStores}
            assignSearch={c.assignSearch}
            setAssignSearch={c.setAssignSearch}
            grantStoreIds={c.grantStoreIds}
            setGrantStoreIds={c.setGrantStoreIds}
            grantPending={c.grantMutation.isPending}
            onGrant={async (repId, storeId) => { await c.grantMutation.mutateAsync({ repId, storeId }); }}
            onRevoke={(repId, storeId) => c.revokeMutation.mutate({ repId, storeId })}
          />
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <CostSettingsTab
            reps={c.reps}
            profileOf={c.profileOf}
            costRepId={c.costRepId}
            setCostRepId={c.setCostRepId}
            costSearch={c.costSearch}
            setCostSearch={c.setCostSearch}
            filteredCostProducts={c.filteredCostProducts}
            repCosts={c.repCosts}
            expandedCostProducts={c.expandedCostProducts}
            setExpandedCostProducts={c.setExpandedCostProducts}
            costDrafts={c.costDrafts}
            setCostDrafts={c.setCostDrafts}
            savePending={c.batchCostMutation.isPending}
            onSave={(repId, items) => c.batchCostMutation.mutate({ repId, items })}
          />
        </TabsContent>
      </Tabs>

      <CommissionDialog
        show={c.showCommissionDialog}
        onShowChange={c.setShowCommissionDialog}
        editingRep={c.editingRep}
        onEditingChange={c.setEditingRep}
        mutation={c.commissionMutation}
      />
    </div>
  );
}