import type { ContentType, Platform } from "../shared/types.ts";
import { currentPack } from "./platform-pack.ts";

export interface SubmitRule {
  texts: string[];
  scope?: string;
  confirm?: string[];
  done: RegExp;
}

export const submitRuleFor = (platform: Platform, type: ContentType): SubmitRule | undefined => currentPack()?.submit[platform]?.[type];

export const canAutoSubmit = (platform: Platform, type: ContentType) => !!submitRuleFor(platform, type);
