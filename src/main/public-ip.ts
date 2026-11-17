import { networkInterfaces } from "node:os";

const SOURCES = ["https://ip.3322.net", "https://ddns.oray.com/checkip", "https://4.ipw.cn", "https://api.ipify.org"];
const TIMEOUT_MS = 5000;
const IPV4 = /\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/;

export interface IpInfo {
  publicIp: string;
  localIps: string[];
  checkedAt: string;
  error?: string;
}

function localIps() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
}

async function ask(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "curl/8" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const ip = (await res.text()).match(IPV4)?.[0];
  if (!ip) throw new Error("bad reply");
  return ip;
}

let cached: IpInfo | undefined;

export async function lookupIp(force = false): Promise<IpInfo> {
  if (cached && !force) return cached;
  let publicIp = "";
  for (const url of SOURCES) {
    publicIp = await ask(url).catch(() => "");
    if (publicIp) break;
  }
  cached = { publicIp, localIps: localIps(), checkedAt: new Date().toISOString(), ...(publicIp ? {} : { error: "查不到公网 IP，请检查网络" }) };
  return cached;
}
