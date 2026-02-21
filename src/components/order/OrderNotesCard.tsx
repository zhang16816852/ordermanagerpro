import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface OrderNotesCardProps {
    notes: string;
    createdAt: string;
    onNotesChange: (notes: string) => void;
}

export function OrderNotesCard({ notes, createdAt, onNotesChange }: OrderNotesCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>訂單備註</CardTitle>
                <CardDescription>
                    建立時間：{createdAt}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Textarea
                    placeholder="輸入訂單備註..."
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    rows={3}
                />
            </CardContent>
        </Card>
    );
}
