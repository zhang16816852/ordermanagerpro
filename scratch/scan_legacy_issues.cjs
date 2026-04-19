const fs = require('fs');
const path = 'test_product.txt';

try {
    const rawData = fs.readFileSync(path, 'utf8');
    const products = JSON.parse(rawData);
    const results = [];

    products.forEach(p => {
        let issues = [];
        const ts = p.table_settings;
        const hasVariants = !!p.has_variants;

        // 1. 檢查舊版格式 (Object 而非 Array)
        const isLegacyFormat = ts && !Array.isArray(ts) && typeof ts === 'object' && Object.keys(ts).length > 0;
        if (isLegacyFormat) issues.push("舊版格式 (Object)");

        // 2. 檢查父層數據衝突 (有變體但不該有規格)
        const hasParentData = (Array.isArray(ts) && ts.length > 0) || isLegacyFormat;
        if (hasVariants && hasParentData) issues.push("有變體但父層帶有規格");

        // 3. 檢查 UUID 路徑毀損
        if (Array.isArray(ts)) {
            if (ts.some(entry => /^[0-9a-f-]{36}$/i.test(entry.path || ""))) {
                issues.push("規格路徑損毀 (UUID)");
            }
        }

        // 4. 變體層級檢查
        if (p.variants) {
            p.variants.forEach(v => {
                const vts = v.table_settings;
                if (Array.isArray(vts)) {
                    if (vts.some(e => /^[0-9a-f-]{36}$/i.test(e.path || ""))) {
                        issues.push(`變體 [${v.sku}] 路徑損毀`);
                    }
                } else if (vts && !Array.isArray(vts) && Object.keys(vts).length > 0) {
                    issues.push(`變體 [${v.sku}] 舊版格式`);
                }
            });
        }

        if (issues.length > 0) {
            results.push({
                name: p.name,
                sku: p.sku,
                issues: [...new Set(issues)]
            });
        }
    });

    fs.writeFileSync('legacy_issues_report.json', JSON.stringify(results, null, 2));
    console.log(`掃描完成！共發現 ${results.length} 個產品存在遺留問題。報告已儲存至 legacy_issues_report.json`);
} catch (e) {
    console.error("解析失敗:", e.message);
}
