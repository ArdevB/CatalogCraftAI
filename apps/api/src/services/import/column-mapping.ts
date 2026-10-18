import type { ColumnMapping, ProductValues, StandardField } from '@catalogcraft/shared';
import { STANDARD_FIELDS, fieldLabel } from '@catalogcraft/shared';
import { AppError } from '../../utils/app-error.js';

/** "Item SKU #" → "itemsku" — so header spelling, spacing and case don't matter. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Common supplier/platform spellings for each field (already normalized).
 * Order matters only within a field; the first column that matches wins.
 */
const SYNONYMS: Record<StandardField, string[]> = {
  sku: ['sku', 'skucode', 'itemsku', 'variantsku', 'articlenumber', 'articleno', 'itemcode', 'productcode', 'partnumber', 'partno', 'stockcode'],
  productId: ['productid', 'id', 'itemid', 'handle', 'productnumber'],
  title: ['title', 'name', 'productname', 'producttitle', 'itemname', 'itemtitle'],
  description: ['description', 'desc', 'productdescription', 'longdescription', 'bodyhtml', 'body', 'details'],
  brand: ['brand', 'brandname', 'vendor', 'manufacturer', 'make'],
  productType: ['producttype', 'type', 'itemtype'],
  category: ['category', 'categories', 'productcategory', 'department', 'collection'],
  material: ['material', 'materials', 'fabric', 'composition'],
  colour: ['colour', 'color', 'colourname', 'colorname'],
  size: ['size', 'sizes'],
  dimensions: ['dimensions', 'dimension', 'measurements'],
  weight: ['weight', 'weightkg', 'weightg', 'grams', 'variantgrams', 'shippingweight'],
  price: ['price', 'retailprice', 'rrp', 'saleprice', 'variantprice', 'unitprice', 'sellingprice'],
  currency: ['currency', 'currencycode'],
  stockQuantity: ['stock', 'stockquantity', 'stocklevel', 'qty', 'quantity', 'inventory', 'inventoryquantity', 'variantinventoryqty'],
  barcode: ['barcode', 'ean', 'ean13', 'upc', 'gtin', 'variantbarcode'],
  tags: ['tags', 'keywords'],
  seoTitle: ['seotitle', 'metatitle'],
  seoDescription: ['seodescription', 'metadescription'],
  imageUrl: ['imageurl', 'image', 'imagesrc', 'imagelink', 'picture', 'photo', 'mainimage'],
  variantId: ['variantid', 'variationid', 'variant'],
  parentId: ['parentid', 'parentsku', 'parent', 'parentproductid', 'groupid'],
};

/** Suggests a mapping from header names. Each column is suggested for at most one field. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const { key } of STANDARD_FIELDS) {
    for (const synonym of SYNONYMS[key]) {
      const column = normalized.findIndex((header, index) => header === synonym && !used.has(index));
      if (column !== -1) {
        mapping[key] = column;
        used.add(column);
        break;
      }
    }
  }
  return mapping;
}

/** Rejects mappings that point at missing columns, reuse a column, or can't identify products. */
export function assertValidMapping(mapping: ColumnMapping, headers: string[]): void {
  const problems: string[] = [];
  const usedBy = new Map<number, StandardField>();

  for (const [field, column] of Object.entries(mapping) as Array<[StandardField, number]>) {
    if (column >= headers.length) {
      problems.push(`${fieldLabel(field)} is mapped to a column that does not exist.`);
      continue;
    }
    const other = usedBy.get(column);
    if (other) {
      problems.push(`Column “${headers[column]}” is mapped to both ${fieldLabel(other)} and ${fieldLabel(field)}.`);
    }
    usedBy.set(column, field);
  }
  if (mapping.sku === undefined && mapping.productId === undefined) {
    problems.push('Map a SKU or Product ID column so every product can be identified.');
  }
  if (problems.length > 0) {
    throw new AppError('VALIDATION_ERROR', problems.join(' '), {
      details: problems.map((message) => ({ path: 'body.mapping', message })),
    });
  }
}

/** Reads the mapped fields of one row, trimming surrounding whitespace. */
export function extractValues(values: string[], mapping: ColumnMapping): ProductValues {
  const product: ProductValues = {};
  for (const [field, column] of Object.entries(mapping) as Array<[StandardField, number]>) {
    product[field] = (values[column] ?? '').trim();
  }
  return product;
}
