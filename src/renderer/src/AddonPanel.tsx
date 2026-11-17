import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Space, Tag, Typography, message } from "antd";
import { FEATURE_LABELS, FEATURE_MP_SITE, hasFeature, type LicenseFeature, type LicenseView } from "../../shared/license";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const CONSENT_KEY = "fanpost.addonConsent";
const CONSENT_VERSION = 1;

const HIDDEN_FEATURES: LicenseFeature[] = [FEATURE_MP_SITE];

const FEATURE_DESC: Record<LicenseFeature, string> = {
  "mp-site": "作者内部使用的扩展，公开版不包含。",
  "hot-create": "热点雷达按账号赛道推荐选题，AI 读取账号作品生成画像，按账号风格分别写图文，进待审箱确认后再发。",
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

export function AddonPanel({ onGoLicense }: { onGoLicense?: () => void }) {
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
      {(Object.keys(FEATURE_LABELS) as LicenseFeature[]).filter((f) => !HIDDEN_FEATURES.includes(f) || granted(f)).map((f) => (
        <div className="setting-row" key={f}>
          <span>
            <b>{FEATURE_LABELS[f]}</b>
            <small>{FEATURE_DESC[f]}</small>
          </span>
          {hasFeature(view, f) ? <Tag color="success">已激活</Tag> : granted(f) ? <Tag color="warning">主授权不可用，暂停</Tag> : <Tag>未激活</Tag>}
        </div>
      ))}
      {!licensed && <Alert type="info" showIcon message="插件绑定在主卡密上，先在「系统设置 → 授权」激活主卡密。" />}
      <Alert
        type="success"
        showIcon
        message="插件卡密直接填在「系统设置 → 授权」的输入框里就行"
        description="主卡和插件卡用同一个输入框：粘进去自动识别。插件卡不能单独用，要先有主卡密；激活后跟着主卡走，主卡解绑换电脑插件一起迁，主卡到期插件暂停。"
        action={
          <Button size="small" onClick={onGoLicense}>
            去授权页
          </Button>
        }
      />
      <Space.Compact className="license-activate">
        <Input
          placeholder="也可以在这里输入插件卡密"
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
        插件卡密单独购买。只填插件卡、还没激活主卡时，先去「授权」激活主卡再来。
      </Typography.Text>
    </div>
  );
}
