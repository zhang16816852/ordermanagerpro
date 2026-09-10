import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PrintDialog, PrintOptions } from "@/components/PrintDialog";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { exportDocExcel } from "./exportExcel";

export interface ReceiptItem {
  name: string;
  variant?: string | null;
  quantity: number;
  unit_price: number | null;
}

interface ReceiptTotals {
  itemCount: number;
  totalQty: number;
  totalAmount: number;
}

export function calcReceiptTotals(items: ReceiptItem[]): ReceiptTotals {
  const itemCount = items.length;
  const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const totalAmount = items.reduce(
    (sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price ?? 0),
    0,
  );
  return { itemCount, totalQty, totalAmount };
}

export const ITEMS_PER_PAGE: Record<"a4" | "middle-cut", number> = {
  a4: 16,
  "middle-cut": 6,
};

/* 每頁筆數採「兩層」：前面無底部框頁用 maxCapacity，最後一頁（含總計+備註框）用 lastCapacity */
export const CHUNK_CAPACITY: Record<"a4" | "middle-cut", { max: number; last: number }> = {
  a4: { max: 17, last: 16 },
  "middle-cut": { max: 8, last: 6 },
};

/**
 * 分頁：前面每頁最多 max 筆、最後一頁最多 last 筆，序號整單連續。
 * 單頁（<= max）直接全放；多頁時前面頁填 max，末頁盡量 <= last。
 */
function buildPageSizes(total: number, max: number, last: number): number[] {
  if (total <= 0) return [0];
  if (total <= max) return [total];

  const sizes: number[] = [];
  let rem = total;
  while (rem > last) {
    sizes.push(max);
    rem -= max;
  }
  if (rem > 0) {
    sizes.push(rem);
  } else if (rem < 0) {
    sizes[sizes.length - 1] = max + rem;
  }
  return sizes;
}

interface SharedReceiptProps {
  items: ReceiptItem[];
  title: string;
  docTitleLabel: string;
  storeName: string;
  code?: string;
  createdAt: string;
  status: string;
  notes?: string;
  qrValue?: string;
  filenamePrefix: string;
  canViewPrice: boolean;
  printButtonLabel?: string;
  printMode?: boolean;
  webPreview?: boolean;
  pagination?: boolean;
  defaultPaperSize?: "a4" | "middle-cut";
  webShowPrice?: boolean;
  webShowQR?: boolean;
}

function HeaderRow({ showPrice }: { showPrice: boolean }) {
  if (showPrice) {
    return (
      <tr className="doc-head">
        <th style={{ width: "5%" }}>#</th>
        <th style={{ width: "42%" }}>商品名稱</th>
        <th style={{ width: "8%" }}>數量</th>
        <th style={{ width: "13%" }}>單價</th>
        <th style={{ width: "16%" }}>小計</th>
        <th style={{ width: "16%" }}>備註</th>
      </tr>
    );
  }
  return (
    <tr className="doc-head">
      <th style={{ width: "6%" }}>#</th>
      <th style={{ width: "60%" }}>商品名稱</th>
      <th style={{ width: "14%" }}>數量</th>
      <th style={{ width: "20%" }}>備註</th>
    </tr>
  );
}

function ReceiptPage({
  items,
  startIndex,
  capacity,
  pageIndex,
  totalPages,
  showPrice,
  showQR,
  qrValue,
  title,
  docTitleLabel,
  storeName,
  code,
  createdAt,
  status,
  widthClass,
  children,
}: {
  items: ReceiptItem[];
  startIndex: number;
  capacity: number;
  pageIndex: number;
  totalPages: number;
  showPrice: boolean;
  showQR: boolean;
  qrValue?: string;
  title: string;
  docTitleLabel: string;
  storeName: string;
  code?: string;
  createdAt: string;
  status: string;
  notes?: string;
  widthClass: "a4" | "middle-cut";
  children?: ReactNode;
}) {
  return (
    <div className="doc-page">
      <div className="doc-head-wrap">
        <div className="doc-page-no">第 {pageIndex + 1} 頁 / 共 {totalPages} 頁</div>
        <div className="doc-title">{title}：{code || "—"}</div>
        <div className="doc-store">{docTitleLabel}：{storeName}</div>
        <div className="doc-meta-row">
          <div className="doc-meta">
            日期：{new Date(createdAt).toLocaleString("zh-TW", { hour12: false })}
            {status ? <><br />狀態：{status}</> : null}
          </div>
          {showQR && qrValue && (
            <div className="doc-qr">
              <QRCodeSVG value={qrValue} size={72} />
            </div>
          )}
        </div>
      </div>
      <table className="doc-table">
        <thead>
          <HeaderRow showPrice={showPrice} />
        </thead>
        <tbody>
          {items.map((item, i) => {
            const name = item.variant || item.name;
            const qty = Number(item.quantity || 0);
            return (
              <tr key={i}>
                <td className="doc-center">{startIndex + i + 1}</td>
                <td className="doc-name">{name}</td>
                <td className="doc-center">{qty}</td>
                {showPrice && (
                  <>
                    <td className="doc-right doc-num">{formatCurrency(item.unit_price ?? 0)}</td>
                    <td className="doc-right doc-num">{formatCurrency(Number(item.unit_price ?? 0) * qty)}</td>
                  </>
                )}
                <td className="doc-note"></td>
              </tr>
            );
          })}
          {items.length < capacity && (
            <>
              {Array.from({ length: capacity - items.length }).map((_, k) => (
                <tr key={`e-${k}`} className="doc-empty">
                  <td></td>
                  <td></td>
                  <td></td>
                  {showPrice && (<><td></td><td></td></>)}
                  <td></td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
      {children}
    </div>
  );
}

export function SharedReceiptExport(props: SharedReceiptProps): JSX.Element {
  const {
    items,
    title,
    docTitleLabel,
    storeName,
    code,
    createdAt,
    status,
    notes,
    qrValue,
    filenamePrefix,
    canViewPrice,
    printButtonLabel,
    printMode,
    webPreview,
    pagination: paginationProp,
    defaultPaperSize = "a4",
    webShowPrice: webShowPriceProp,
    webShowQR: webShowQRProp,
  } = props;

  const printRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    output: "pdf",
    paperSize: defaultPaperSize,
    margin: "standard",
    showPrice: true,
    showQR: true,
  });

  const [pagination, setPagination] = useState(paginationProp ?? true);
  const [paperSize, setPaperSize] = useState<"a4" | "middle-cut">(defaultPaperSize);
  const [webShowPrice, setWebShowPrice] = useState(webShowPriceProp ?? true);
  const [webShowQR, setWebShowQR] = useState(webShowQRProp ?? true);

  const widthClass: "a4" | "middle-cut" = webPreview ? paperSize : printOptions.paperSize;
  const baseShowPrice = canViewPrice && items.length > 0 && items[0].unit_price !== null;
  const showPrice = webPreview ? baseShowPrice && webShowPrice : baseShowPrice && printOptions.showPrice;
  const showQR = webPreview ? webShowQR : printOptions.showQR;

  const statusText = status;

  // 分頁：前面頁用 maxCapacity、末頁用 lastCapacity，序號整單連續
  const cap = CHUNK_CAPACITY[widthClass];
  const pageSizes = buildPageSizes(items.length, cap.max, cap.last);
  const pageChunks: ReceiptItem[][] = [];
  let idx = 0;
  pageSizes.forEach((size) => {
    pageChunks.push(items.slice(idx, idx + size));
    idx += size;
  });
  const totalPages = Math.max(pageChunks.length, 1);

  const ensurePrintClasses = () => {
    const el = printRef.current;
    if (!el) return;
    el.classList.add("is-printing-mode");
    const sizeClass = printOptions.paperSize === "a4" ? "print-a4" : "print-middle-cut";
    el.classList.add(sizeClass);
  };

  const clearPrintClasses = () => {
    const el = printRef.current;
    if (!el) return;
    el.classList.remove("is-printing-mode", "print-a4", "print-middle-cut", "print-no-margin");
  };

  const handleExport = async (options: PrintOptions) => {
    setPrintOptions(options);
    if (options.output === "excel") {
      setIsDialogOpen(false);
      try {
        await exportDocExcel({
          title,
          code,
          created_at: createdAt,
          storeLabel: docTitleLabel,
          store_name: storeName,
          notes,
          items,
          showPrice,
          filename: `${filenamePrefix}_${code || "note"}`,
        });
        toast.success("Excel 匯出成功");
      } catch (err) {
        console.error("Excel 匯出失敗", err);
        toast.error("Excel 匯出失敗");
      }
      return;
    }

    // pdf (html2pdf 攫取印刷版型為圖片)
    setIsDialogOpen(false);
    setIsCapturing(true);
    toast.info("正在產生 PDF 並匯出...");
    const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number],
      filename: `${filenamePrefix}_${code || "note"}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        letterRendering: true,
        windowWidth: widthClass === "a4" ? 794 : 911,
      },
      jsPDF: {
        unit: "mm",
        format: options.paperSize === "a4" ? "a4" : ([241, 140] as [number, number]),
        orientation: "portrait" as const,
      },
      pagebreak: { mode: ["css", "legacy"] },
    };
    try {
      // 等 version 渲染後再攫取（wrap 只在 capture 期間短暫掛載）
      await new Promise((r) => setTimeout(r, 100));
      ensurePrintClasses();
      const element = printRef.current;
      if (!element) throw new Error("print element missing");
      const { default: html2pdf } = await import("html2pdf.js");
      await html2pdf().set(opt).from(element).save();
      toast.success("PDF 匯出成功");
    } catch (err) {
      console.error("PDF generation error:", err);
      toast.error("PDF 產生失敗，請確認瀏覽器權限或試試列印功能");
      window.print();
    } finally {
      clearPrintClasses();
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    if (printMode) {
      setTimeout(() => window.print(), 600);
    }
    return () => clearPrintClasses();
  }, [printMode]);

  // 僅在「列印模式」或「擷取 PDF」期間短暫掛載印刷版型，webPreview 常駐
  const shouldRenderPrint = !!printMode || isCapturing || !!webPreview;

  const receiptContent = (
    <div
      ref={webPreview ? undefined : printRef}
      className={[
        "doc-receipt-wrap",
        widthClass === "a4" ? "print-a4" : "print-middle-cut",
        webPreview ? "doc-receipt-web-preview" : "",
        webPreview && pagination ? "doc-receipt-paginated" : "",
      ].filter(Boolean).join(" ")}
      {...(!webPreview && !printMode ? {} : {})}
    >
      {(() => {
        const pages: JSX.Element[] = [];
        let running = 0;
        pageChunks.forEach((chunk, pageIndex) => {
          const isLast = pageIndex === pageChunks.length - 1;
          pages.push(
            <ReceiptPage
              key={pageIndex}
              items={chunk}
              startIndex={running}
              capacity={pageSizes[pageIndex]}
              pageIndex={pageIndex}
              totalPages={totalPages}
              showPrice={showPrice}
              showQR={showQR}
              qrValue={qrValue}
              title={title}
              docTitleLabel={docTitleLabel}
              storeName={storeName}
              code={code}
              createdAt={createdAt}
              status={statusText}
              notes={notes}
              widthClass={widthClass}
            >
              {isLast && (
                <LastPageSummary
                  items={items}
                  showPrice={showPrice}
                  notes={notes}
                  canShowPrice={baseShowPrice}
                />
              )}
            </ReceiptPage>
          );
          running += chunk.length;
        });
        return pages;
      })()}
    </div>
  );

  return (
    <>
      {!printMode && !webPreview && (
        <>
          <PrintDialog
            isOpen={isDialogOpen}
            onClose={() => setIsDialogOpen(false)}
            onPrint={handleExport}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsDialogOpen(true)}
            className="print:hidden"
          >
            <Printer className="h-4 w-4 mr-2" />
            {printButtonLabel || "列印 / PDF / Excel"}
          </Button>
        </>
      )}

      {webPreview && !printMode && (
        <div className="flex flex-wrap items-center justify-end gap-2 pb-3 print:hidden">
          <div className="flex items-center rounded-lg border overflow-hidden">
            <button
              type="button"
              className={`text-xs px-2 py-1 ${pagination ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              onClick={() => setPagination(true)}
            >
              分頁
            </button>
            <button
              type="button"
              className={`text-xs px-2 py-1 ${!pagination ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              onClick={() => setPagination(false)}
            >
              連續
            </button>
          </div>
          {baseShowPrice && (
            <div className="flex items-center rounded-lg border overflow-hidden">
              <button
                type="button"
                className={`text-xs px-2 py-1 ${webShowPrice ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                onClick={() => setWebShowPrice(true)}
              >
                顯示價格
              </button>
              <button
                type="button"
                className={`text-xs px-2 py-1 ${!webShowPrice ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                onClick={() => setWebShowPrice(false)}
              >
                隱藏價格
              </button>
            </div>
          )}
          {qrValue && (
            <div className="flex items-center rounded-lg border overflow-hidden">
              <button
                type="button"
                className={`text-xs px-2 py-1 ${webShowQR ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                onClick={() => setWebShowQR(true)}
              >
                顯示 QR
              </button>
              <button
                type="button"
                className={`text-xs px-2 py-1 ${!webShowQR ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                onClick={() => setWebShowQR(false)}
              >
                隱藏 QR
              </button>
            </div>
          )}
          <select
            className="text-xs border rounded px-1 py-1"
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as "a4" | "middle-cut")}
          >
            <option value="a4">A4</option>
            <option value="middle-cut">中一刀</option>
          </select>
        </div>
      )}

      {webPreview && receiptContent}

      {shouldRenderPrint && !webPreview &&
        createPortal(receiptContent, document.body)
      }
    </>
  );
}

function LastPageSummary({
  items,
  showPrice,
  notes,
  canShowPrice,
}: {
  items: ReceiptItem[];
  showPrice: boolean;
  notes?: string;
  canShowPrice: boolean;
}) {
  const { itemCount, totalQty, totalAmount } = calcReceiptTotals(items);
  return (
    <div className="doc-summary-wrap">
      <div className="doc-summary-notes">
        <div className="doc-summary-title">備註</div>
        <div className="doc-summary-notes-body">{notes || ""}</div>
      </div>
      <div className="doc-summary-stats">
        <div className="doc-summary-row">
          <span>品項數</span>
          <span className="doc-summary-val">{itemCount} 項</span>
        </div>
        <div className="doc-summary-row">
          <span>總件數</span>
          <span className="doc-summary-val">{totalQty} 件</span>
        </div>
        {canShowPrice && (
          <div className="doc-summary-row doc-summary-total">
            <span>總金額</span>
            <span className="doc-summary-val">{showPrice ? formatCurrency(totalAmount) : "—"}</span>
          </div>
        )}
      </div>
    </div>
  );
}