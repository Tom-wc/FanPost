import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Space, Tag, Typography, message } from "antd";
import { FEATURE_LABELS, FEATURE_MP_SITE, hasFeature, type LicenseFeature, type LicenseView } from "../../shared/license";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const CONSENT_KEY = "fanpost.addonConsent";
const CONSENT_VERSION = 1;

const FEATURE_DESC: Record<LicenseFeature, string> = {
  "mp-site": "在公众号「排版」里从壹伴、135、365 按 ID 提取模板和单个素材，套到自己的文章上。",
};

export const MP_SITE_TERMS = [
  "模板站采集只用于把你有权使用的版式，套用到你自己运营的公众号文章。",
  "第三方站点的模板、素材、图片，版权归原作者或站点所有；付费素材需要你已在该站点获得授权。",
  "不得把采集结果转售、打包分发，或做成对外的模板库。",
  "软件只在你本机解析你主动输入的页面，不上传、不共享采集内容。",
  "因使用采集内容产生的版权纠纷，由使用者自行承担。",
];

export function useLicenseView() {
  const [view, setView] = useState<LicenseView>();
  useEffect(() => {
    void window.fanpost.getLicense().then(setView).catch(() => undefined);
    return window.fanpost.onLicenseChanged(setView);
  }, []);
  return view;
}

export function useFeature(feature: LicenseFeature) {
  const view = useLicenseView();
  return !!view && hasFeature(view, feature);
}

function readConsent(feature: LicenseFeature) {
  try {
    const all = JSON.parse(localStorage.getItem(CONSENT_KEY) || "{}") as Record<string, number>;
    return all[feature] === CONSENT_VERSION;
  } catch {
    return false;
  }
}

function writeConsent(feature: LicenseFeature) {
  try {
    const all = JSON.parse(localStorage.getItem(CONSENT_KEY) || "{}") as Record<string, number>;
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ ...all, [feature]: CONSENT_VERSION }));
  } catch {
    return;
  }
}

export function confirmMpSiteTerms(): Promise<boolean> {
  if (readConsent(FEATURE_MP_SITE)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let agreed = false;
    const modal = Modal.confirm({
      title: "模板站采集 · 使用须知",
      width: 520,
      icon: null,
      okText: "同意并继续",
      cancelText: "取消",
      okButtonProps: { disabled: true },
      content: (
        <div className="addon-terms">
          <ol>
            {MP_SITE_TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <Checkbox
            onChange={(e) => {
              agreed = e.target.checked;
              modal.update({ okButtonProps: { disabled: !agreed } });
            }}
          >
            我已阅读并同意以上须知
          </Checkbox>
        </div>
      ),
      onOk: () => {
        writeConsent(FEATURE_MP_SITE);
        resolve(true);
      },
      onCancel: () => resolve(false),
    });
  });
}

export function AddonPanel() {
  const view = useLicenseView();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  if (!view) return <Typography.Text type="secondary">正在读取授权…</Typography.Text>;
  const licensed = view.tier !== "none";
  const activate = async () => {
    setBusy(true);
    try {
      await window.fanpost.activateAddon(key);
      setKey("");
      message.success("插件已激活");
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const granted = (f: LicenseFeature) => view.features.includes(f);
  return (
    <div className="addon-panel">
      {(Object.keys(FEATURE_LABELS) as LicenseFeature[]).map((f) => (
        <div className="setting-row" key={f}>
          <span>
            <b>{FEATURE_LABELS[f]}</b>
            <small>{FEATURE_DESC[f]}</small>
          </span>
          {hasFeature(view, f) ? <Tag color="success">已激活</Tag> : granted(f) ? <Tag color="warning">主授权不可用，暂停</Tag> : <Tag>未激活</Tag>}
        </div>
      ))}
      {!licensed && <Alert type="info" showIcon message="插件绑定在主卡密上，先在「系统设置 → 授权」激活主卡密。" />}
      <Space.Compact className="license-activate">
        <Input
          placeholder="输入插件卡密，如 ABCD-EFGH-JKLM-NPQR"
          value={key}
          disabled={!licensed}
          onChange={(e) => setKey(e.target.value)}
          onPressEnter={() => key.trim() && void activate()}
        />
        <Button type="primary" loading={busy} disabled={!licensed || !key.trim()} onClick={() => void activate()}>
          激活插件
        </Button>
      </Space.Compact>
      <Typography.Text type="secondary" className="license-tiers">
        插件卡密单独购买，激活后跟随主卡密：主卡解绑换电脑，插件一起迁过去；主卡到期或失效，插件同时暂停。
      </Typography.Text>
    </div>
  );
}
