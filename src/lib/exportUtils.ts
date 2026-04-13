import Papa from 'papaparse';
import html2pdf from 'html2pdf.js';

/**
 * 匯出資料為 CSV 檔案
 * @param data 資料陣列
 * @param filename 檔案名稱 (不含副檔名)
 */
export function exportToCSV(data: any[], filename: string = 'export') {
    if (!data || data.length === 0) return;

    // 轉換為 CSV 字串
    const csv = Papa.unparse(data);

    // 加入 BOM (Byte Order Mark) 以便 Windows Excel 正確讀取繁體中文 (UTF-8)
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}_${new Date().getTime()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

/**
 * 匯出 HTML 元素為 PDF 檔案
 * @param elementId 要轉換的元素 ID
 * @param filename 檔案名稱 (不含副檔名)
 */
export async function exportToPDF(elementId: string, filename: string = 'report') {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element with id ${elementId} not found`);
        return;
    }

    const options = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: `${filename}_${new Date().getTime()}.pdf`,
        image: { type: 'jpeg' as 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm' as 'mm', format: 'a4' as 'a4', orientation: 'portrait' as 'portrait' }
    };

    try {
        await html2pdf().set(options).from(element).save();
    } catch (error) {
        console.error('PDF Export Error:', error);
    }
}
