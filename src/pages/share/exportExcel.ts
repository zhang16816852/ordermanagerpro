import * as XLSX from "xlsx";

export interface ExportExcelItem {
  name: string;
  variant?: string | null;
  quantity: number;
  unit_price: number | null;
}

interface ExportDocExcelOptions {
  title: string;
  code?: string;
  created_at: string;
  storeLabel: string;
  store_name: string;
  notes?: string;
  items: ExportExcelItem[];
  showPrice: boolean;
  filename: string;
}

export async function exportDocExcel(opts: ExportDocExcelOptions): Promise<void> {
  const { items, showPrice } = opts;

  const rows: (string | number)[][] = [];
  rows.push([`${opts.title}`, opts.code || ""]);
  rows.push([opts.storeLabel, opts.store_name]);
  rows.push(["日期", new Date(opts.created_at).toLocaleDateString("zh-TW")]);
  rows.push([]);

  const header = showPrice
    ? ["商品名稱", "數量", "單價", "小計"]
    : ["商品名稱", "數量"];
  rows.push(header);

  items.forEach((item) => {
    const name = item.variant || item.name;
    const base: (string | number)[] = [name, item.quantity];
    if (showPrice) {
      const price = Number(item.unit_price ?? 0);
      base.push(price, price * item.quantity);
    }
    rows.push(base);
  });

  if (showPrice) {
    rows.push([]);
    const itemCount = items.length;
    const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
    const totalAmount = items.reduce(
      (sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price ?? 0),
      0,
    );
    rows.push(["品項數", `${itemCount} 項`]);
    rows.push(["總件數", `${totalQty} 件`]);
    rows.push(["總金額", totalAmount]);
  }

  if (opts.notes && opts.notes.trim()) {
    rows.push([]);
    rows.push(["備註", opts.notes]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = showPrice
    ? [{ wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 14 }]
    : [{ wch: 40 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.title.slice(0, 31) || "Sheet1");

  const safeFilename = opts.filename.endsWith(".xlsx") ? opts.filename : `${opts.filename}.xlsx`;
  XLSX.writeFile(wb, safeFilename);
}
