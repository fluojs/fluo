export interface UserRecord {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly region: string;
  readonly createdAt: number;
}

export interface ReadSearchInput {
  readonly tenantId: string;
  readonly role: string;
  readonly status: string;
  readonly region: string;
  readonly sort: string;
  readonly page: string;
  readonly limit: string;
}

export interface QuoteItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface QuoteInput {
  readonly customerId: string;
  readonly coupon: string;
  readonly items: readonly QuoteItem[];
  readonly shippingRegion: string;
}

export interface RouteMixInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId?: string;
  readonly include?: string;
  readonly state?: string;
  readonly priority?: string;
  readonly body?: { readonly action?: string; readonly estimateHours?: number };
}

const USERS: readonly UserRecord[] = Array.from({ length: 1_000 }, (_, index) => {
  const sequence = index + 1;
  const role = sequence % 3 === 0 ? 'admin' : sequence % 3 === 1 ? 'maintainer' : 'viewer';
  const status = sequence % 4 === 0 ? 'inactive' : 'active';
  const region = sequence % 2 === 0 ? 'west' : 'east';

  return {
    id: `u-${String(sequence).padStart(4, '0')}`,
    name: `User ${String(sequence).padStart(4, '0')}`,
    role,
    status,
    region,
    createdAt: 1_700_000_000 + sequence,
  };
});

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function checksum(values: readonly string[]): number {
  let hash = 0;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) % 1_000_000_007;
    }
  }
  return hash;
}

export function readSearchLocal(input: ReadSearchInput) {
  const page = positiveInteger(input.page, 1);
  const limit = positiveInteger(input.limit, 25);
  const filtered = USERS
    .filter((user) => user.role === input.role && user.status === input.status && user.region === input.region)
    .sort((left, right) => (input.sort === 'createdAt' ? right.createdAt - left.createdAt : left.id.localeCompare(right.id)));
  const items = filtered.slice((page - 1) * limit, page * limit).map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    region: user.region,
  }));

  return {
    tenantId: input.tenantId,
    page,
    limit,
    total: filtered.length,
    firstId: items[0]?.id ?? '',
    lastId: items.at(-1)?.id ?? '',
    checksum: checksum(items.map((item) => item.id)),
    items,
  };
}

export function jsonCommandLocal(input: QuoteInput) {
  const subtotalCents = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const discountCents = input.coupon === 'BETA10' ? Math.round(subtotalCents * 0.1) : 0;
  const taxableCents = subtotalCents - discountCents;
  const taxRate = input.shippingRegion === 'west' ? 0.0825 : 0.05;
  const taxCents = Math.round(taxableCents * taxRate);
  const shippingCents = taxableCents >= 10_000 ? 0 : 799;

  return {
    customerId: input.customerId,
    itemCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents,
    discountCents,
    taxCents,
    shippingCents,
    totalCents: taxableCents + taxCents + shippingCents,
    shippingRegion: input.shippingRegion,
  };
}

export function restRouteMixLocal(kind: 'project' | 'task-list' | 'task-detail' | 'preview' | 'comments', input: RouteMixInput) {
  const seed = checksum([input.tenantId, input.projectId, input.taskId ?? '', kind]);
  switch (kind) {
    case 'project':
      return {
        kind,
        tenantId: input.tenantId,
        projectId: input.projectId,
        include: input.include ?? 'summary',
        openTasks: 18 + (seed % 7),
        health: seed % 2 === 0 ? 'green' : 'yellow',
      };
    case 'task-list':
      return {
        kind,
        tenantId: input.tenantId,
        projectId: input.projectId,
        state: input.state ?? 'open',
        priority: input.priority ?? 'all',
        ids: [1, 2, 3, 4].map((offset) => `task-${String((seed + offset) % 97).padStart(3, '0')}`),
      };
    case 'task-detail':
      return {
        kind,
        tenantId: input.tenantId,
        projectId: input.projectId,
        taskId: input.taskId ?? '',
        assignee: `u-${String((seed % 50) + 1).padStart(4, '0')}`,
        estimateHours: 2 + (seed % 13),
      };
    case 'preview':
      return {
        kind,
        tenantId: input.tenantId,
        projectId: input.projectId,
        taskId: input.taskId ?? '',
        action: input.body?.action ?? 'noop',
        projectedHours: (input.body?.estimateHours ?? 0) + (seed % 5),
      };
    case 'comments':
      return {
        kind,
        tenantId: input.tenantId,
        projectId: input.projectId,
        taskId: input.taskId ?? '',
        count: 3 + (seed % 8),
        checksum: seed,
      };
  }
}

export const READ_SEARCH_PATH = '/tenants/t-001/users?role=admin&status=active&region=west&sort=createdAt&page=2&limit=25';
export const READ_SEARCH_RESPONSE = JSON.stringify(readSearchLocal({
  tenantId: 't-001',
  role: 'admin',
  status: 'active',
  region: 'west',
  sort: 'createdAt',
  page: '2',
  limit: '25',
}));

export const QUOTE_REQUEST: QuoteInput = {
  customerId: 'cust-001',
  coupon: 'BETA10',
  shippingRegion: 'west',
  items: [
    { sku: 'sku-001', quantity: 2, unitPriceCents: 2_500 },
    { sku: 'sku-014', quantity: 1, unitPriceCents: 7_250 },
    { sku: 'sku-105', quantity: 3, unitPriceCents: 1_250 },
  ],
};
export const QUOTE_REQUEST_BODY = JSON.stringify(QUOTE_REQUEST);
export const QUOTE_RESPONSE = JSON.stringify(jsonCommandLocal(QUOTE_REQUEST));

export const ROUTE_MIX_REQUEST_BODY = JSON.stringify({ action: 'reassign', estimateHours: 8 });
export const ROUTE_MIX_PATHS = [
  '/tenants/t-001/projects/p-001?include=stats',
  '/tenants/t-001/projects/p-001/tasks?state=open&priority=high',
  '/tenants/t-001/projects/p-001/tasks/task-042',
  '/tenants/t-001/projects/p-001/tasks/task-042/preview',
  '/tenants/t-001/projects/p-001/tasks/task-042/comments',
] as const;
export const ROUTE_MIX_RESPONSES = [
  JSON.stringify(restRouteMixLocal('project', { tenantId: 't-001', projectId: 'p-001', include: 'stats' })),
  JSON.stringify(restRouteMixLocal('task-list', { tenantId: 't-001', projectId: 'p-001', state: 'open', priority: 'high' })),
  JSON.stringify(restRouteMixLocal('task-detail', { tenantId: 't-001', projectId: 'p-001', taskId: 'task-042' })),
  JSON.stringify(restRouteMixLocal('preview', { tenantId: 't-001', projectId: 'p-001', taskId: 'task-042', body: { action: 'reassign', estimateHours: 8 } })),
  JSON.stringify(restRouteMixLocal('comments', { tenantId: 't-001', projectId: 'p-001', taskId: 'task-042' })),
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toQuoteInput(value: unknown): QuoteInput {
  if (!isRecord(value)) throw new TypeError('Quote body must be an object');
  const itemsValue = value.items;
  const items: QuoteItem[] = Array.isArray(itemsValue)
    ? itemsValue.filter(isRecord).map((item) => ({
        sku: typeof item.sku === 'string' ? item.sku : '',
        quantity: typeof item.quantity === 'number' ? item.quantity : 0,
        unitPriceCents: typeof item.unitPriceCents === 'number' ? item.unitPriceCents : 0,
      }))
    : [];
  return {
    customerId: typeof value.customerId === 'string' ? value.customerId : '',
    coupon: typeof value.coupon === 'string' ? value.coupon : '',
    shippingRegion: typeof value.shippingRegion === 'string' ? value.shippingRegion : '',
    items,
  };
}

export function toPreviewBody(value: unknown): { action: string; estimateHours: number } {
  if (!isRecord(value)) return { action: '', estimateHours: 0 };
  return {
    action: typeof value.action === 'string' ? value.action : '',
    estimateHours: typeof value.estimateHours === 'number' ? value.estimateHours : 0,
  };
}

export function queryValue(value: string | readonly string[] | undefined): string {
  return typeof value === 'string' ? value : value?.[0] ?? '';
}
