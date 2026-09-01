import type { FrameworkRequest } from './types.js';

type ParsedAddress =
  | { readonly kind: 'ipv4'; readonly value: bigint }
  | { readonly kind: 'ipv6'; readonly value: bigint };

type ForwardedElement = {
  readonly address: string;
  readonly host?: string;
  readonly protocol?: string;
};

type ForwardingSource =
  | {
      readonly addresses: readonly string[];
      readonly elements: readonly ForwardedElement[];
      readonly kind: 'forwarded';
    }
  | {
      readonly addresses: readonly string[];
      readonly kind: 'x-forwarded-for' | 'x-real-ip';
    };

type HeaderValue = {
  readonly present: boolean;
  readonly value: string | undefined;
};

/**
 * Function that decides whether one proxy hop is trusted.
 *
 * @param address Proxy address being considered, starting with the direct transport peer.
 * @param index Zero-based distance from the direct transport peer.
 * @returns Whether the proxy hop may supply forwarding metadata.
 */
export type TrustProxyPredicate = (address: string, index: number) => boolean;

/**
 * Explicit policy that permits forwarding metadata from known proxy hops.
 *
 * `false` disables proxy trust, a number trusts that many nearest hops, an
 * address/CIDR list matches nearest hops, and a predicate receives each hop
 * from nearest to furthest.
 */
export type TrustProxyPolicy = false | number | readonly string[] | TrustProxyPredicate;

/**
 * Options used to derive a trusted connection snapshot.
 */
export interface ResolveHttpConnectionOptions {
  /**
   * Proxy trust boundary. The default is `false`, so forwarded headers never
   * override the direct transport identity without an explicit policy.
   */
  trustProxy?: TrustProxyPolicy;
  /**
   * Retains the legacy header-only migration path for integrations that do not
   * expose a transport peer. New integrations must leave this disabled.
   */
  allowForwardedWithoutPeer?: boolean;
}

/**
 * Immutable, runtime-neutral view of the connection identity selected for a request.
 */
export interface HttpConnection {
  /** First untrusted address in the client-to-server chain, when available. */
  readonly clientAddress: string | undefined;
  /** Public host selected from trusted forwarding metadata or the request host header. */
  readonly host: string | undefined;
  /** Host without an optional port selected from `host`. */
  readonly hostname: string | undefined;
  /** Numeric port selected from `host`, when present and valid. */
  readonly port: number | undefined;
  /** `http` or `https` selected from transport or trusted forwarding metadata. */
  readonly protocol: 'http' | 'https';
  /** Trusted proxy addresses between `clientAddress` and `remoteAddress`. */
  readonly proxyChain: readonly string[];
  /** Direct adapter transport peer address, when available. */
  readonly remoteAddress: string | undefined;
  /** Whether `protocol` is `https`. */
  readonly secure: boolean;
}

function readHeader(
  headers: FrameworkRequest['headers'],
  name: string,
): HeaderValue {
  const values: string[] = [];
  let present = false;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) {
      continue;
    }

    present = true;

    if (typeof value === 'string') {
      values.push(value);
    } else if (Array.isArray(value)) {
      values.push(...value);
    }
  }

  const joined = values.join(',').trim();
  return { present, value: joined || undefined };
}

function normalizeAddress(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.toLowerCase() === 'unknown' || trimmed.startsWith('_')) {
    return undefined;
  }

  let address = trimmed;

  if (trimmed.startsWith('[')) {
    const bracketed = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);

    if (!bracketed) {
      return undefined;
    }

    if (bracketed[2] !== undefined && !isValidPort(bracketed[2])) {
      return undefined;
    }

    address = bracketed[1]!;
  } else {
    const ipv4WithPort = trimmed.match(/^((?:\d{1,3}\.){3}\d{1,3}):(\d+)$/);

    if (ipv4WithPort) {
      if (!isValidPort(ipv4WithPort[2]!)) {
        return undefined;
      }

      address = ipv4WithPort[1]!;
    }
  }

  const parsed = parseAddress(address);

  if (!parsed) {
    return undefined;
  }

  if (parsed.kind === 'ipv4') {
    return formatIpv4(parsed.value);
  }

  const mappedIpv4 = ipv4FromMappedIpv6(parsed.value);
  return mappedIpv4 === undefined ? address.toLowerCase() : formatIpv4(mappedIpv4);
}

function splitOutsideQuotes(value: string, separator: string): string[] | undefined {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (quoted && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }

    if (!quoted && character === separator) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (quoted || escaped) {
    return undefined;
  }

  parts.push(current.trim());
  return parts;
}

function unquoteForwardedValue(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.startsWith('"')) {
    return trimmed.includes('"') ? undefined : trimmed;
  }

  if (!trimmed.endsWith('"') || trimmed.length < 2) {
    return undefined;
  }

  let unquoted = '';
  let escaped = false;

  for (const character of trimmed.slice(1, -1)) {
    if (escaped) {
      unquoted += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else {
      unquoted += character;
    }
  }

  return escaped ? undefined : unquoted;
}

function parseForwarded(value: string | undefined): readonly ForwardedElement[] | undefined {
  if (!value) {
    return undefined;
  }

  const elements = splitOutsideQuotes(value, ',');

  if (!elements || elements.some((element) => !element)) {
    return undefined;
  }

  const parsed: ForwardedElement[] = [];

  for (const element of elements) {
    const parameters = splitOutsideQuotes(element, ';');

    if (!parameters || parameters.some((parameter) => !parameter)) {
      return undefined;
    }

    let address: string | undefined;
    let host: string | undefined;
    let protocol: string | undefined;
    const keys = new Set<string>();

    for (const parameter of parameters) {
      const separator = parameter.indexOf('=');

      if (separator <= 0) {
        return undefined;
      }

      const key = parameter.slice(0, separator).trim().toLowerCase();
      const rawParameterValue = parameter.slice(separator + 1);
      const parameterValue = unquoteForwardedValue(rawParameterValue);

      if (!key || !parameterValue || keys.has(key)) {
        return undefined;
      }

      keys.add(key);

      if (key === 'for') {
        const isUnquotedIpv4WithPort = /^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(parameterValue);

        if (!rawParameterValue.trim().startsWith('"') && parameterValue.includes(':') && !isUnquotedIpv4WithPort) {
          return undefined;
        }
        address = normalizeAddress(parameterValue);
      } else if (key === 'host') {
        host = parameterValue.trim() || undefined;
      } else if (key === 'proto') {
        protocol = parameterValue.trim().toLowerCase();
      }
    }

    if (!address) {
      return undefined;
    }

    parsed.push({ address, host, protocol });
  }

  return parsed;
}

function parseForwardedFor(value: string | undefined): readonly string[] | undefined {
  if (!value) {
    return undefined;
  }

  const values = value.split(',');

  if (values.length === 0) {
    return undefined;
  }

  const addresses: string[] = [];

  for (const value of values) {
    const address = normalizeAddress(value);

    if (!address) {
      return undefined;
    }

    addresses.push(address);
  }

  return addresses;
}

function parseIpv4(value: string): bigint | undefined {
  const parts = value.split('.');

  if (parts.length !== 4) {
    return undefined;
  }

  let result = 0n;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }

    const octet = Number(part);

    if (octet > 255) {
      return undefined;
    }

    result = (result << 8n) + BigInt(octet);
  }

  return result;
}

function parseIpv6(value: string): bigint | undefined {
  const normalized = value.toLowerCase();
  const ipv4Separator = normalized.lastIndexOf(':');
  const ipv4Candidate = ipv4Separator === -1 ? undefined : normalized.slice(ipv4Separator + 1);
  const ipv4 = ipv4Candidate?.includes('.') ? parseIpv4(ipv4Candidate) : undefined;
  const ipv6Value = ipv4 !== undefined
    ? `${normalized.slice(0, ipv4Separator)}:${((ipv4 >> 16n) & 0xffffn).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`
    : normalized;
  const doubleColon = ipv6Value.indexOf('::');

  if (doubleColon !== -1 && doubleColon !== ipv6Value.lastIndexOf('::')) {
    return undefined;
  }

  const [head, tail] = doubleColon === -1
    ? [ipv6Value, '']
    : [ipv6Value.slice(0, doubleColon), ipv6Value.slice(doubleColon + 2)];
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];

  if (headParts.some((part) => !/^[\da-f]{1,4}$/.test(part)) ||
    tailParts.some((part) => !/^[\da-f]{1,4}$/.test(part))) {
    return undefined;
  }

  const missingParts = 8 - headParts.length - tailParts.length;

  if ((doubleColon === -1 && missingParts !== 0) || (doubleColon !== -1 && missingParts < 1)) {
    return undefined;
  }

  const parts = [...headParts, ...Array.from({ length: missingParts }, () => '0'), ...tailParts];
  let result = 0n;

  for (const part of parts) {
    result = (result << 16n) + BigInt(`0x${part}`);
  }

  return result;
}

function parseAddress(value: string): ParsedAddress | undefined {
  const ipv4 = parseIpv4(value);

  if (ipv4 !== undefined) {
    return { kind: 'ipv4', value: ipv4 };
  }

  const ipv6 = parseIpv6(value);
  return ipv6 === undefined ? undefined : { kind: 'ipv6', value: ipv6 };
}

function formatIpv4(value: bigint): string {
  return [
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  ].join('.');
}

function ipv4FromMappedIpv6(value: bigint): bigint | undefined {
  return value >> 32n === 0xffffn ? value & 0xffffffffn : undefined;
}

function isValidPort(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }

  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65_535;
}

function matchesAddressOrCidr(address: string, rule: string): boolean {
  const [network, prefixText, ...extra] = rule.trim().split('/');

  if (!network || extra.length > 0) {
    return false;
  }

  const candidate = parseAddress(address);
  let target = parseAddress(network);

  if (!candidate || !target) {
    return false;
  }

  if (prefixText !== undefined && !/^\d+$/.test(prefixText)) {
    return false;
  }

  let prefix = prefixText === undefined ? undefined : Number(prefixText);
  const targetBits = target.kind === 'ipv4' ? 32 : 128;

  if (prefix !== undefined && (prefix < 0 || prefix > targetBits)) {
    return false;
  }

  if (target.kind === 'ipv6') {
    const mappedIpv4 = ipv4FromMappedIpv6(target.value);

    if (mappedIpv4 !== undefined) {
      if (prefix !== undefined && prefix < 96) {
        return false;
      }

      target = { kind: 'ipv4', value: mappedIpv4 };
      prefix = prefix === undefined ? undefined : prefix - 96;
    }
  }

  if (candidate.kind !== target.kind) {
    return false;
  }

  if (prefix === undefined) {
    return candidate.value === target.value;
  }

  const bits = candidate.kind === 'ipv4' ? 32 : 128;

  if (prefix === 0) {
    return true;
  }

  const shift = BigInt(bits - prefix);
  return (candidate.value >> shift) === (target.value >> shift);
}

function isTrustedProxy(
  policy: TrustProxyPolicy,
  address: string,
  index: number,
): boolean {
  if (policy === false) {
    return false;
  }

  if (typeof policy === 'number') {
    return Number.isInteger(policy) && policy > index;
  }

  if (typeof policy === 'function') {
    return policy(address, index);
  }

  return policy.some((rule) => matchesAddressOrCidr(address, rule));
}

function resolveRemoteAddress(request: FrameworkRequest): string | undefined {
  if (request.connection?.remoteAddress) {
    return normalizeAddress(request.connection.remoteAddress);
  }

  if (!request.raw || typeof request.raw !== 'object') {
    return undefined;
  }

  const socket = (request.raw as { socket?: { remoteAddress?: unknown } }).socket;
  return typeof socket?.remoteAddress === 'string' ? normalizeAddress(socket.remoteAddress) : undefined;
}

function resolveTransportProtocol(request: FrameworkRequest): 'http' | 'https' {
  if (request.connection?.protocol) {
    return request.connection.protocol;
  }

  if (!request.raw || typeof request.raw !== 'object') {
    return 'http';
  }

  const socket = (request.raw as { socket?: { encrypted?: unknown } }).socket;
  return socket?.encrypted === true ? 'https' : 'http';
}

function parseHost(value: string | undefined): {
  readonly host: string | undefined;
  readonly hostname: string | undefined;
  readonly port: number | undefined;
} {
  const host = value?.trim() || undefined;

  if (!host || host.includes(',')) {
    return { host: undefined, hostname: undefined, port: undefined };
  }

  if (host.startsWith('[')) {
    const bracketed = host.match(/^\[([^\]]+)\](?::(\d+))?$/);

    if (!bracketed || parseAddress(bracketed[1]!)?.kind !== 'ipv6' ||
      (bracketed[2] !== undefined && !isValidPort(bracketed[2]))) {
      return { host: undefined, hostname: undefined, port: undefined };
    }

    const hostname = bracketed[1]!.toLowerCase();
    const port = bracketed[2] === undefined ? undefined : Number(bracketed[2]);
    return { host, hostname, port };
  }

  const authority = host.match(/^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d+))?$/);

  if (!authority || (authority[2] !== undefined && !isValidPort(authority[2]))) {
    return { host: undefined, hostname: undefined, port: undefined };
  }

  return {
    host,
    hostname: authority[1]!.toLowerCase(),
    port: authority[2] === undefined ? undefined : Number(authority[2]),
  };
}

function resolveForwardingSource(headers: FrameworkRequest['headers']): ForwardingSource | undefined {
  const forwardedHeader = readHeader(headers, 'forwarded');

  if (forwardedHeader.present) {
    const elements = parseForwarded(forwardedHeader.value);
    return elements
      ? { addresses: elements.map((element) => element.address), elements, kind: 'forwarded' }
      : undefined;
  }

  const xForwardedForHeader = readHeader(headers, 'x-forwarded-for');

  if (xForwardedForHeader.present) {
    const addresses = parseForwardedFor(xForwardedForHeader.value);
    return addresses ? { addresses, kind: 'x-forwarded-for' } : undefined;
  }

  const xRealIpHeader = readHeader(headers, 'x-real-ip');

  if (!xRealIpHeader.present) {
    return undefined;
  }

  const address = normalizeAddress(xRealIpHeader.value);
  return address ? { addresses: [address], kind: 'x-real-ip' } : undefined;
}

function readIndexedForwardingMetadata(
  headers: FrameworkRequest['headers'],
  name: string,
  index: number,
  expectedLength: number,
): string | undefined {
  const header = readHeader(headers, name);

  if (!header.value) {
    return undefined;
  }

  const values = header.value.split(',').map((value) => value.trim());
  return values.length === expectedLength && !values.some((value) => !value) ? values[index] : undefined;
}

/**
 * Resolve an immutable connection snapshot using a direct transport identity
 * and only proxy metadata allowed by the explicit trust policy.
 *
 * Malformed forwarding input is ignored as a whole, preserving the direct
 * transport identity. Adapters without a socket address produce an undefined
 * identity rather than trusting a forwarding header by default.
 *
 * @param request Adapter-normalized request whose headers and raw transport are inspected.
 * @param options Explicit proxy trust policy for the current deployment.
 * @returns Immutable connection identity, protocol, host, and trusted proxy chain.
 */
export function resolveHttpConnection(
  request: FrameworkRequest,
  options: ResolveHttpConnectionOptions = {},
): HttpConnection {
  const remoteAddress = resolveRemoteAddress(request);
  const trustProxy = options.trustProxy ?? false;
  const forwarding = resolveForwardingSource(request.headers);
  const headerAddresses = forwarding?.addresses;
  const chain = remoteAddress && headerAddresses && trustProxy !== false
    ? [...headerAddresses, remoteAddress]
    : !remoteAddress && options.allowForwardedWithoutPeer && headerAddresses && trustProxy !== false
      ? [...headerAddresses]
    : remoteAddress
      ? [remoteAddress]
      : [];
  let clientIndex = chain.length - 1;

  while (clientIndex > 0 && isTrustedProxy(trustProxy, chain[clientIndex]!, chain.length - 1 - clientIndex)) {
    clientIndex--;
  }

  const proxyChain = Object.freeze(chain.slice(clientIndex + 1));
  const usesTrustedForwarding = forwarding !== undefined && clientIndex < forwarding.addresses.length &&
    (proxyChain.length > 0 || (!remoteAddress && options.allowForwardedWithoutPeer === true));
  const forwardedElement = usesTrustedForwarding && forwarding?.kind === 'forwarded'
    ? forwarding.elements[clientIndex]
    : undefined;
  const legacyHost = usesTrustedForwarding && forwarding?.kind !== 'forwarded'
    ? readIndexedForwardingMetadata(request.headers, 'x-forwarded-host', clientIndex, forwarding.addresses.length)
    : undefined;
  const legacyProtocol = usesTrustedForwarding && forwarding?.kind !== 'forwarded'
    ? readIndexedForwardingMetadata(request.headers, 'x-forwarded-proto', clientIndex, forwarding.addresses.length)
    : undefined;
  const protocolCandidate = forwardedElement?.protocol ?? legacyProtocol?.toLowerCase();
  const protocol = protocolCandidate === 'https'
    ? 'https'
    : protocolCandidate === 'http'
      ? 'http'
      : resolveTransportProtocol(request);
  const forwardingHost = parseHost(forwardedElement?.host ?? legacyHost);
  const host = forwardingHost.host
    ? forwardingHost
    : parseHost(readHeader(request.headers, 'host').value);

  return Object.freeze({
    clientAddress: chain[clientIndex],
    host: host.host,
    hostname: host.hostname,
    port: host.port,
    protocol,
    proxyChain,
    remoteAddress,
    secure: protocol === 'https',
  });
}
