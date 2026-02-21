interface OrderInfoProps {
    orderId: string;
    storeName?: string;
    createdAt: string;
    sourceType?: 'frontend' | 'admin_proxy';
    notes?: string | null;
}

export function OrderInfo({ orderId, storeName, createdAt, sourceType, notes }: OrderInfoProps) {
    return (
        <>
            {/* Order Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                    <span className="text-muted-foreground mr-2">訂單編號：</span>
                    <span className="font-mono">{orderId}</span>
                </div>

                {storeName && (
                    <div>
                        <span className="text-muted-foreground mr-2">店鋪：</span>
                        <span>{storeName}</span>
                    </div>
                )}

                <div>
                    <span className="text-muted-foreground mr-2">建立時間：</span>
                    <span>{createdAt}</span>
                </div>

                {sourceType && (
                    <div>
                        <span className="text-muted-foreground mr-2">來源：</span>
                        <span>
                            {sourceType === 'frontend' ? '前台訂單' : '後台代訂'}
                        </span>
                    </div>
                )}
            </div>

            {/* Notes */}
            {notes && (
                <div className="text-sm border-l-2 pl-3 py-1 bg-muted/20">
                    <span className="text-muted-foreground mr-2">備註：</span>
                    <span>{notes}</span>
                </div>
            )}
        </>
    );
}
