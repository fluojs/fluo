/**
 * Numeric setup policy shared by first-party Node HTTP hosts.
 *
 * @remarks Hosts retain option evaluation order, defaults, and resource ownership.
 * Node's byte-specific body-limit error is intentionally outside this policy.
 */
export class NodeHttpAdapterOptionPolicy {
  /**
   * Resolve the listener port without coercing caller input.
   *
   * @param value Explicit port, or omission for port 3000.
   * @returns An integer port in the inclusive range 0 through 65535.
   * @throws Error When the resolved port is outside the accepted range.
   */
  static resolvePort(value: number | undefined): number {
    const port = value ?? 3000;

    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid PORT value: ${String(port)}.`);
    }

    return port;
  }

  /**
   * Resolve a non-negative integer option using its host-selected default.
   *
   * @param name Option name used in the existing setup error.
   * @param value Explicit option, including zero.
   * @param defaultValue Host-owned default for an omitted option.
   * @returns The resolved non-negative integer, without a safe-integer restriction.
   * @throws Error When the resolved option is negative or not an integer.
   */
  static resolveNonNegativeIntegerOption(name: string, value: number | undefined, defaultValue: number): number {
    const resolved = value ?? defaultValue;

    NodeHttpAdapterOptionPolicy.validateNonNegativeIntegerOption(name, resolved);

    return resolved;
  }

  /**
   * Validate an already defaulted constructor option without replacing null.
   *
   * @param name Option name used in the existing setup error.
   * @param value Constructor value, after JavaScript parameter defaults.
   * @throws Error When the option is negative or not an integer.
   */
  static validateNonNegativeIntegerOption(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid ${name} value: ${String(value)}. Expected a non-negative integer.`);
    }
  }
}
