import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Lock } from 'lucide-react';

interface LockedOrderViewProps {
    orderId: string;
    orderItems: Array<{
        id: string;
        quantity: number;
        unit_price: number;
        products?: { name: string } | null;
    }>;
    onBack: () => void;
}

export function LockedOrderView({ orderId, orderItems, onBack }: LockedOrderViewProps) {
    const total = orderItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    返回
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">訂單詳情</h1>
                    <p className="text-muted-foreground font-mono text-sm">{orderId}</p>
                </div>
            </div>

            <Card className="border-warning">
                <CardContent className="flex items-center gap-4 py-6">
                    <Lock className="h-8 w-8 text-warning" />
                    <div>
                        <h3 className="font-semibold">訂單已鎖定</h3>
                        <p className="text-muted-foreground">
                            此訂單已進入處理階段，無法再進行修改。如需修改請聯繫管理員。
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>訂單項目</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>產品名稱</TableHead>
                                <TableHead className="text-right">單價</TableHead>
                                <TableHead className="text-right">數量</TableHead>
                                <TableHead className="text-right">小計</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orderItems.map((item) => (
                                <TableRow key={item.id}>
                                    <TableCell>{item.products?.name}</TableCell>
                                    <TableCell className="text-right">${item.unit_price}</TableCell>
                                    <TableCell className="text-right">{item.quantity}</TableCell>
                                    <TableCell className="text-right font-medium">
                                        ${(item.quantity * item.unit_price).toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="text-right mt-4 text-lg font-semibold">
                        總計：${total.toFixed(2)}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
