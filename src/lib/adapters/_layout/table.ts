// Layout-aware extraction.  Turns the raw stream of positioned text items from
// PDF.js into row-by-row table structure that's resilient to PDF generators
// that emit columns out-of-order.
//
// The algorithm:
//   1. Sort items by Y descending (PDF Y grows upward, so top of page = highest Y).
//   2. Group items whose Y differs by less than `row_tolerance` into one row.
//   3. Within each row, sort by X ascending.
//   4. Optionally detect the table header row by regex; everything below is data.

import type { PdfTextItem, PdfPage } from '../types';

export interface LayoutRow {
  /** Y-coordinate of this row (averaged across items). */
  y: number;
  /** Items belonging to this row, sorted by X ascending. */
  items: PdfTextItem[];
}

/**
 * Group items on one page into rows by Y-coordinate.
 *
 * `row_tolerance` is in PDF units (points, 1pt = 1/72 inch).  3-4 pt typically
 * collapses sub-pixel jitter without merging visually-distinct rows.  Adjust
 * per-bank if a statement uses unusually tight or loose row spacing.
 */
export function groupItemsByRow(items: PdfTextItem[], row_tolerance = 3): LayoutRow[] {
  if (items.length === 0) return [];

  // Sort by Y descending so we visit rows top-to-bottom on the page.
  const sorted = [...items].sort((a, b) => b.y - a.y);

  const rows: LayoutRow[] = [];
  let current: PdfTextItem[] = [];
  let currentY = sorted[0]!.y;
  let currentSum = 0;
  let currentCount = 0;

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) <= row_tolerance) {
      current.push(item);
      currentSum += item.y;
      currentCount += 1;
      currentY = currentSum / currentCount; // running average to handle drift
    } else {
      // Close the current row, start a new one.
      if (current.length > 0) {
        rows.push({ y: currentY, items: sortByX(current) });
      }
      current = [item];
      currentSum = item.y;
      currentCount = 1;
      currentY = item.y;
    }
  }
  if (current.length > 0) {
    rows.push({ y: currentY, items: sortByX(current) });
  }
  return rows;
}

function sortByX(items: PdfTextItem[]): PdfTextItem[] {
  return [...items].sort((a, b) => a.x - b.x);
}

/**
 * Concatenate a row's items into a single string for regex matching against
 * the row as a whole, preserving column gaps via spaces.
 */
export function rowText(row: LayoutRow, separator = ' '): string {
  return row.items
    .map((i) => i.text)
    .join(separator)
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ColumnSpec {
  /** Human-readable column name for debugging. */
  name: string;
  /** X-coordinate where this column starts (left edge). */
  x_min: number;
  /** X-coordinate where this column ends (right edge). */
  x_max: number;
}

/**
 * Extract a row's content into named columns.  Items are assigned to the column
 * whose [x_min, x_max] range contains the item's left edge.  Items outside any
 * column range are dropped.
 *
 * Returns an object keyed by column name; each value is the concatenated text
 * of items within that column (multiple items per column join with a space).
 */
export function extractColumns(row: LayoutRow, columns: ColumnSpec[]): Record<string, string> {
  const result: Record<string, string[]> = {};
  for (const col of columns) result[col.name] = [];

  for (const item of row.items) {
    const col = columns.find((c) => item.x >= c.x_min && item.x < c.x_max);
    if (col === undefined) continue;
    result[col.name]!.push(item.text);
  }

  const final: Record<string, string> = {};
  for (const col of columns) {
    final[col.name] = (result[col.name] ?? []).join(' ').replace(/\s+/g, ' ').trim();
  }
  return final;
}

/**
 * Find the row whose text matches a header regex (case-insensitive).  Returns
 * the row index, or -1 if no header found.  Bank adapters typically anchor
 * their column-extraction to this row.
 */
export function findHeaderRowIndex(rows: LayoutRow[], headerRegex: RegExp): number {
  for (let i = 0; i < rows.length; i++) {
    const text = rowText(rows[i]!);
    if (headerRegex.test(text)) return i;
  }
  return -1;
}

/**
 * Convenience: group every page's items into rows and return a flat list of
 * rows across the whole document.  Page boundaries are preserved by the order
 * of rows (page 1 first, then page 2, etc.).
 */
export function groupAllRows(pages: PdfPage[], row_tolerance = 3): LayoutRow[] {
  const all: LayoutRow[] = [];
  for (const page of pages) {
    all.push(...groupItemsByRow(page.items, row_tolerance));
  }
  return all;
}
