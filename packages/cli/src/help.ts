type HelpTableColumn<Row> = {
  header: string;
  render: (row: Row) => string;
};

function border(widths: number[]): string {
  return `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
}

function renderRow(values: string[], widths: number[]): string {
  return `| ${values.map((value, index) => value.padEnd(widths[index] ?? 0)).join(' | ')} |`;
}

/**
 * Render alias list.
 *
 * @param aliases The aliases.
 * @returns The render alias list result.
 */
export function renderAliasList(aliases: string[]): string {
  return aliases.length === 0 ? '-' : aliases.join(', ');
}

/**
 * Render help table.
 *
 * @param rows The rows.
 * @param columns The columns.
 * @returns The render help table result.
 */
export function renderHelpTable<Row>(rows: Row[], columns: HelpTableColumn<Row>[]): string {
  const widths = columns.map((column) => {
    const values = rows.map((row) => column.render(row));
    return Math.max(column.header.length, ...values.map((value) => value.length));
  });

  return [
    border(widths),
    renderRow(columns.map((column) => column.header), widths),
    border(widths),
    ...rows.map((row) => renderRow(columns.map((column) => column.render(row)), widths)),
    border(widths),
  ].join('\n');
}
