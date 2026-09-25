import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Loader2, AlertCircle, ReceiptText, ChevronDown, Package } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface StatementItem {
  product_name: string;
  variant_name?: string | null;
  quantity: number;
  unit_price: number | null;
  sort_order?: number;
}

interface StatementNote {
  id: string;
  code?: string | null;
  status: string;
  payment_status: string;
  shipped_at?: string | null;
  notes?: string | null;
  shipping_fee?: number | null;
  delivery_method_title?: string | null;
  access_token?: string | null;
  items: StatementItem[];
}

interface SharedStatementData {
  statement: {
    id: string;
    title: string;
    date_from: string;
    date_to: string;
    created_at: string;
  };
  store: {
    id: string;
    name: string;
    code?: string | null;
    recipient?: string | null;
    phone?: string | null;
    city?: string | null;
    district?: string | null;
    address?: string | null;
  };
  notes: StatementNote[];
}

const itemName = (item: StatementItem) => item.variant_name || item.product_name;
const itemAmount = (item: StatementItem) => (item.quantity || 0) * (item.unit_price || 0);

function noteSubtotal(note: StatementNote) {
  return (note.items || []).reduce((s, i) => s + itemAmount(i), 0);
}
function noteTotal(note: StatementNote) {
  return noteSubtotal(note) + (note.shipping_fee || 0);
}

function PaymentStatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return <Badge className="bg-green-600 text-white">已收款</Badge>;
  }
  if (status === "partial") {
    return <Badge variant="secondary" className="text-amber-600">部分收款</Badge>;
  }
  return <Badge variant="secondary" className="text-amber-600">未收款</Badge>;
}

function StatementNoteRow({ note }: { note: StatementNote }) {
  const [expanded, setExpanded] = useState(false);
  const items = [...(note.items || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const subtotal = noteSubtotal(note);
  const showShipping = (note.shipping_fee || 0) > 0;
  const noteQty = items.reduce((s, i) => s + (i.quantity || 0), 0);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="rounded-lg border">
      <CollapsibleTrigger className="w-full">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-left">
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-180")}
          />
          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium">{note.code || note.id.slice(0, 8)}</span>
          <span className="text-xs text-muted-foreground">
            {note.shipped_at ? format(new Date(note.shipped_at), "yyyy/MM/dd") : ""}
          </span>
          <span className="text-xs text-muted-foreground">
            {items.length} 品項 ・ 共 {noteQty} 件
          </span>
          <PaymentStatusBadge status={note.payment_status} />
          <span className="flex-1" />
          <span className="font-semibold">{formatCurrency(noteTotal(note))}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">此單據無品項。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="py-1.5 pr-2 font-medium w-8">#</th>
                    <th className="py-1.5 px-2 font-medium">品項</th>
                    <th className="py-1.5 px-2 font-medium text-right">數量</th>
                    <th className="py-1.5 px-2 font-medium text-right">單價</th>
                    <th className="py-1.5 pl-2 font-medium text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 pr-2 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2 px-2">{itemName(item)}</td>
                      <td className="py-2 px-2 text-right">{item.quantity}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(item.unit_price || 0)}</td>
                      <td className="py-2 pl-2 text-right font-medium">{formatCurrency(itemAmount(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              小計：<span className="font-medium text-foreground">{formatCurrency(subtotal)}</span>
            </span>
            {showShipping && (
              <span className="text-muted-foreground">
                運費
                {note.delivery_method_title ? `（${note.delivery_method_title}）` : ""}：
                <span className="font-medium text-foreground">{formatCurrency(note.shipping_fee || 0)}</span>
              </span>
            )}
            <span>
              合計：<span className="font-semibold">{formatCurrency(noteTotal(note))}</span>
            </span>
          </div>

          {note.notes && <p className="text-sm text-muted-foreground">備註：{note.notes}</p>}
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function SharedCustomerStatement() {
  const { statementId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-statement", statementId, token],
    queryFn: async () => {
      if (!statementId || !token) throw new Error("連結無效");
      const { data, error } = await (supabase as any).rpc("get_shared_customer_statement", {
        p_statement_id: statementId,
        p_token: token,
      });
      if (error) throw error;
      if (!data) throw new Error("找不到對帳單或連結已失效");
      return data as SharedStatementData;
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto p-4 max-w-md mt-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>無法讀取對帳單</AlertTitle>
          <AlertDescription>連結可能錯誤或已失效。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { statement, store, notes } = data;
  const sortedNotes = [...(notes || [])];
  const totalNotes = sortedNotes.length;
  const totalItems = sortedNotes.reduce((s, n) => s + (n.items || []).length, 0);
  const totalQty = sortedNotes.reduce(
    (s, n) => s + (n.items || []).reduce((x, i) => x + (i.quantity || 0), 0),
    0
  );
  const totalAmount = sortedNotes.reduce((s, n) => s + noteTotal(n), 0);

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ReceiptText className="h-5 w-5" />
            {statement.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {store.name}（{store.code || "-"}）・
            {format(new Date(statement.date_from), "yyyy/MM/dd")} ~{" "}
            {format(new Date(statement.date_to), "yyyy/MM/dd")}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4 text-sm">
          <span>
            銷貨單：<strong>{totalNotes}</strong> 張
          </span>
          <span className="text-muted-foreground">|</span>
          <span>
            品項：<strong>{totalItems}</strong> 項
          </span>
          <span className="text-muted-foreground">|</span>
          <span>
            總件數：<strong>{totalQty}</strong> 件
          </span>
          <span className="text-muted-foreground">|</span>
          <span>
            總金額：<strong>{formatCurrency(totalAmount)}</strong>
          </span>
        </CardContent>
      </Card>

      {sortedNotes.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          此區間內沒有銷售紀錄。點擊下方各單可展開查看明細。
        </div>
      ) : (
        <div className="space-y-2">
          {sortedNotes.map((note) => (
            <StatementNoteRow key={note.id} note={note} />
          ))}
        </div>
      )}

      <div className="text-center text-xs text-muted-foreground pt-2">
        此對帳單由 {store.name} 提供・可點開個別單據查看明細・價格僅供對帳參考
      </div>
    </div>
  );
}