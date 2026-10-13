import { format } from "date-fns";
import { toast } from "sonner";
import type { SalesNoteRow } from "./salesNotesTypes";

export function getPageNumbers(page: number, totalPages: number): (number | "ellipsis")[] {
	const pages: (number | "ellipsis")[] = [];
	if (totalPages <= 7) {
		for (let i = 1; i <= totalPages; i++) pages.push(i);
	} else {
		pages.push(1);
		if (page > 3) pages.push("ellipsis");
		const start = Math.max(2, page - 1);
		const end = Math.min(totalPages - 1, page + 1);
		for (let i = start; i <= end; i++) pages.push(i);
		if (page < totalPages - 2) pages.push("ellipsis");
		pages.push(totalPages);
	}
	return pages;
}

export async function exportSalesNotesExcel(
  salesNotes: SalesNoteRow[] | undefined,
  selectedNoteIds: string[],
) {
  const notesToExport = (salesNotes || []).filter((n) => selectedNoteIds.includes(n.id));
  if (notesToExport.length === 0) {
    toast.error("請先勾選要匯出的銷貨單");
    return;
  }
  const xlsx = await import("xlsx");
  const rows: (string | number)[][] = [];
  let grandTotal = 0;
  let grandQty = 0;

  for (const note of notesToExport) {
    const items = [...(note.sales_note_items || [])].sort(
      (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    rows.push([`銷貨單 ${note.code || note.id.slice(0, 8)}`, "", "", "", ""]);
    rows.push([
      "店家",
      note.store?.name || "-",
      "日期",
      note.shipped_at
        ? format(new Date(note.shipped_at), "yyyy/MM/dd")
        : format(new Date(note.created_at), "yyyy/MM/dd"),
      "",
    ]);
    rows.push(["變體編號", "商品名稱", "數量", "單價", "銷售金額"]);

    let subtotal = 0;
    let qty = 0;
    for (const item of items) {
      const name =
        item.order_item?.product_variant?.name ||
        item.order_item?.product?.name ||
        "未知產品";
      // 優先取變體 SKU（變體編號）；無變體的品項回退產品編號
      const code = item.order_item?.product_variant?.sku || item.order_item?.product?.code || "-";
      const unit = Number(item.order_item?.unit_price || 0);
      const amt = Number(item.quantity || 0) * unit;
      rows.push([code, name, Number(item.quantity || 0), unit, amt]);
      subtotal += amt;
      qty += Number(item.quantity || 0);
    }
    rows.push(["小計", "", qty, "", subtotal]);
    rows.push([]);
    grandTotal += subtotal;
    grandQty += qty;
  }

  rows.push(["總計", `${notesToExport.length} 張 · 共 ${grandQty} 件`, "", "", grandTotal]);

  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 18 }, { wch: 44 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "銷貨單");
  xlsx.writeFile(wb, `銷貨單匯出_${format(new Date(), "yyyyMMdd")}.xlsx`);
  toast.success(`已匯出 ${notesToExport.length} 張銷貨單`);
}
