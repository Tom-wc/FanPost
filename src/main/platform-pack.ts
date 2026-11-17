import type { PlatformPack } from "../shared/platform-pack.ts";

let pack: PlatformPack | undefined;

export const currentPack = () => pack;

export function setPack(next: PlatformPack | undefined) {
  pack = next;
}
