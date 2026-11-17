import { useState } from "react";
import { Button, Result } from "antd";
import { LockOutlined } from "@ant-design/icons";
import type { AppData } from "../../shared/types";
import { FEATURE_HOT } from "../../shared/license";
import { LeadsPage } from "./LeadsPage";
import { HotPage } from "./HotPage";
import { useFeature } from "./AddonPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { HelpLink } from "./Tutorial";

export type GrowthTab = "hot" | "leads";

const TAB_KEY = "fanpost.growthTab";

function readTab(): GrowthTab {
  try {
    return localStorage.getItem(TAB_KEY) === "leads" ? "leads" : "hot";
  } catch {
    return "hot";
  }
}

function HotLocked({ onActivate }: { onActivate: () => void }) {
  return (
    <section className="panel growth-locked">
      <Result
        icon={<LockOutlined />}
        title="热点创作是扩展插件"
        subTitle="每天抓 6 个平台热榜，按账号赛道让 AI 挑出能切入的选题，按每个账号的画像分别写图文，进待审箱确认后存草稿。需要单独的插件卡密。"
        extra={[
          <Button type="primary" key="go" onClick={onActivate}>去激活插件</Button>,
          <HelpLink key="help" topic="hot" label="先看使用说明" />,
        ]}
      />
    </section>
  );
}

export function GrowthPage({ data, setData, onGoAccounts, onGoDrafts, onGoSettings }: { data: AppData; setData: (d: AppData) => void; onGoAccounts: () => void; onGoDrafts: (type: "image_text" | "video") => void; onGoSettings: () => void }) {
  const [tab, setTabState] = useState<GrowthTab>(readTab);
  const hotOn = useFeature(FEATURE_HOT);
  const setTab = (t: GrowthTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      void 0;
    }
  };
  return (
    <div className="growth-page">
      <div className="settings-switch growth-switch" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "hot"} className={tab === "hot" ? "active" : ""} onClick={() => setTab("hot")}>
          <b>热点创作 {!hotOn && <LockOutlined className="growth-lock" />}</b>
          <small>按账号赛道选热点，AI 分账号写稿</small>
        </button>
        <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "active" : ""} onClick={() => setTab("leads")}>
          <b>评论 · 私信</b>
          <small>扫描各平台评论，按意向自动或批量回复</small>
        </button>
      </div>
      <div className="growth-body">
        <ErrorBoundary>
          {tab === "hot" ? (
            hotOn ? (
              <HotPage data={data} setData={setData} onGoDrafts={onGoDrafts} />
            ) : (
              <HotLocked onActivate={onGoSettings} />
            )
          ) : (
            <LeadsPage accounts={data.accounts} onGoAccounts={onGoAccounts} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
