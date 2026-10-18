import ExcelJS from 'exceljs';

/** Builds a real .xlsx file in memory. Values can be plain or Excel objects (e.g. formulas). */
export async function makeXlsx(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const worksheet = workbook.addWorksheet(name);
    rows.forEach((row, index) => {
      // Write at an explicit row number so `[]` leaves a genuinely blank row.
      worksheet.getRow(index + 1).values = row as ExcelJS.CellValue[];
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const SAMPLE_CSV = [
  'SKU,Product Name,Description,Price,Currency,Stock,EAN,Image',
  'MUG-001,Stoneware mug,A 350 ml stoneware mug.,12.50,USD,40,4006381333931,https://img.example.com/mug.jpg',
  'MUG-002,Enamel mug,,9.99,USD,15,,https://img.example.com/enamel.jpg',
  'TEA-010,Loose leaf tea tin,Airtight tin.,7,USD,100,,',
].join('\n');
