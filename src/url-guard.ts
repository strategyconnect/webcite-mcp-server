import * as dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Defence in depth for URLs the API will fetch (upload_url). The API's own guard resolves DNS, pins each
 * hop to a public address and re-checks redirects; this only refuses obviously non-public targets early.
 */
const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

const LOOKUP_DEADLINE_MS = 2000;
const INTERNAL_NAME = /(^|\.)(localhost|internal|local|localdomain|home\.arpa)$/i;

/** IPv4-mapped IPv6 addresses (::ffff:10.0.0.1) are matched against the IPv4 rules by BlockList itself. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? blocked.check(address, 'ipv4') : family === 6 ? blocked.check(address, 'ipv6') : false;
}

/**
 * True when the host is an IP literal or name that cannot be a public web server, or a name that resolves
 * to one. A lookup that fails or is slow returns false: the API's guard still decides, so nothing that
 * worked before is newly refused.
 */
export async function isNonPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host)) return isNonPublicAddress(host);
  if (INTERNAL_NAME.test(host)) return true;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<[]>((resolve) => { timer = setTimeout(() => resolve([]), LOOKUP_DEADLINE_MS); });
  try {
    const answers = await Promise.race([dns.promises.lookup(host, { all: true }), late]);
    return answers.some((answer) => isNonPublicAddress(answer.address));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
