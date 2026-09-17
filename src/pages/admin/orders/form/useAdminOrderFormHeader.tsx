import { useLayoutEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lock, Unlock } from 'lucide-react';
import { usePageHeader } from '@/components/layout/PageHeaderContext';

export const statusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
  cancelled: { label: '已取消', className: 'bg-destructive text-destructive-foreground' },
};

interface UseAdminOrderFormHeaderParams {
  isEditMode: boolean;
  orderType: 'sales' | 'purchase' | 'consignment_receive' | 'consignment_send';
  orderIdVal?: string;
  orderCodeVal?: string;
  orderStatusVal?: string;
  orderConsignmentMode?: boolean;
  displayStoreName?: string;
  isTogglePending: boolean;
  onToggleStatus: () => void;
  navigate: (path: string) => void;
  navigateBack: () => void;
}

export function useAdminOrderFormHeader(params: UseAdminOrderFormHeaderParams) {
  const {
    isEditMode,
    orderType,
    orderIdVal,
    orderCodeVal,
    orderStatusVal,
    orderConsignmentMode,
    displayStoreName,
    isTogglePending,
    onToggleStatus,
    navigate,
    navigateBack,
  } = params;
  const { setPageHeader } = usePageHeader();

  // 回呼一律存 ref，避免呼叫端每次 render 傳入新函數造成 deps 變異 → setPageHeader 無限迴圈
  const callbacksRef = useRef({ onToggleStatus, navigate, navigateBack });
  callbacksRef.current = { onToggleStatus, navigate, navigateBack };

  // Sync title & back button & status actions into DesktopHeader / MobileHeader
  useLayoutEffect(() => {
    const titleText = isEditMode ? '編輯訂單' : (
      orderType === 'sales' ? '建立銷售訂單' :
        orderType === 'purchase' ? '建立採購單' :
          orderType === 'consignment_receive' ? '建立寄賣收貨單' :
            '建立寄賣出貨單'
    );
    const { onToggleStatus: toggleStatus, navigate: goTo, navigateBack: goBack } = callbacksRef.current;

    const typeBadgeElem = !isEditMode ? (
      <Badge variant="outline" className={
        orderType === 'purchase' ? 'border-blue-500 text-blue-500' :
          orderType === 'consignment_receive' ? 'border-purple-500 text-purple-500' :
            orderType === 'consignment_send' ? 'border-orange-500 text-orange-500' :
              ''
      }>
        {orderType === 'sales' ? '銷售' :
          orderType === 'purchase' ? '採購' :
            orderType === 'consignment_receive' ? '寄賣收貨' : '寄賣出貨'}
      </Badge>
    ) : null;

    const statusObj = orderStatusVal ? statusLabels[orderStatusVal] || { label: orderStatusVal, className: 'bg-muted text-muted-foreground' } : null;

    setPageHeader({
      title: (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold tracking-tight truncate">{titleText}</span>
          <span className="text-xs text-muted-foreground font-mono truncate hidden sm:inline">
            {isEditMode ? (orderCodeVal || orderIdVal) : (
              orderType === 'sales' ? (displayStoreName ? `(${displayStoreName})` : '') :
                orderType === 'purchase' ? '(採購)' :
                  orderType === 'consignment_receive' ? '(寄賣收貨)' : '(寄賣出貨)'
            )}
          </span>
        </div>
      ),
      onBack: isEditMode ? () => goTo('/admin/orders') : goBack,
      actions: (
        <div className="flex items-center gap-2">
          {typeBadgeElem}
          {statusObj && <Badge className={statusObj.className}>{statusObj.label}</Badge>}
          {orderConsignmentMode && <Badge variant="secondary">寄賣</Badge>}
          {isEditMode && orderStatusVal && orderStatusVal !== 'shipped' && (
            <Button
              variant="outline"
              size="sm"
              onClick={toggleStatus}
              disabled={isTogglePending}
            >
              {orderStatusVal === 'pending' ? (
                <><Lock className="mr-1.5 h-3.5 w-3.5" />鎖定</>
              ) : (
                <><Unlock className="mr-1.5 h-3.5 w-3.5" />解鎖</>
              )}
            </Button>
          )}
        </div>
      ),
    });

    return () => setPageHeader(null);
  }, [
    setPageHeader,
    isEditMode,
    orderIdVal,
    orderCodeVal,
    orderStatusVal,
    orderConsignmentMode,
    displayStoreName,
    orderType,
    isTogglePending,
  ]);
}