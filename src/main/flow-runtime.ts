import type { WebContents } from "electron";
import type { Account, ContentType, Platform, PublishDraft } from "../shared/types";
import type { Declaration } from "../shared/declarations";
import type { PublishProgress, PublishResult } from "./browser/common";
import { CLOSED_FEATURE, closedFeature } from "./closed";

export const FLOWS_MISSING = CLOSED_FEATURE;

interface VideoHost {
  publishUrl: string;
  homeUrl: string;
  updateAccount: (update: { name?: string; loginStatus?: "logged_in" | "logged_out" }) => Promise<void>;
  flush: (reason: string) => Promise<void>;
}

interface FlowModule {
  publishVideo(account: Account, draft: PublishDraft, progress: PublishProgress, host: VideoHost, wc: WebContents, taskId: string): Promise<PublishResult>;
  applyDeclaration(wc: WebContents, platform: Platform, type: ContentType, chosen: Declaration | undefined): Promise<string>;
  applyOriginal(wc: WebContents, platform: Platform, original?: boolean, durationSec?: number): Promise<string>;
  addMusic(wc: WebContents, platform: Platform, type: ContentType): Promise<string>;
  runContentCheck(wc: WebContents, platform: Platform, type: ContentType): Promise<string>;
}

export function flows(): FlowModule {
  return closedFeature();
}
