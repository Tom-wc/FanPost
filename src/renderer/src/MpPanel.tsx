import { useEffect, useState } from "react";
import { Alert, Button, Input, Popconfirm, Tag, message } from "antd";
import { ApiOutlined, ClearOutlined } from "@ant-design/icons";
import { HEALTH_LABEL, type MpHealthView } from "../../shared/mp-health";
import { ensureLicensed, handleQuota } from "./LicensePanel";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function MpPanel() {
  const [saved, setSaved] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<MpHealthView | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    void window.fanpost.getMp().then((r) => {
      setSaved(r.appId);
      setHealth(r.health);
    });
    return window.fanpost.onMpHealth(setHealth);
  }, []);
  const check = async () => {
    setChecking(true);
    try {
      const h = await window.fanpost.checkMp();
      setHealth(h);
      if (h.state === "ok") message.success("公众号接口正常");
      else if (h.state === "unset") message.info("还没有填 AppID 和 AppSecret");
      else message.error(h.message);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setChecking(false);
    }
  };
  const reset = () => {
    setAppId("");
    setSecret("");
  };
  const save = async () => {
    if (!(await ensureLicensed())) return;
    setBusy(true);
    try {
      const r = await window.fanpost.saveMp(appId, secret);
      setSaved(r.appId);
      if (r.health) setHealth(r.health);
      reset();
      if (!r.health || r.health.state === "ok") message.success(saved && saved !== r.appId ? "已换成 " + r.appId + "，旧的已覆盖" : "已保存，接口正常");
      else if (r.health.state === "unset") message.success("已保存");
      else message.warning("已保存，接口暂时连不上（见下方提示）");
    } catch (e) {
      if (!handleQuota(e)) message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    await window.fanpost.clearMp();
    setSaved("");
    setHealth(null);
    reset();
    message.success("已清除，可以重新填写");
  };
  return (
    <div className="mp-panel">
      <div className="license-row">
        <span>状态</span>
        {saved ? <Tag color={health?.state === "failed" ? "error" : health?.state === "offline" ? "warning" : "success"}>{health && health.state !== "unset" ? HEALTH_LABEL[health.state] : "已连接"} {saved}</Tag> : <Tag>未设置</Tag>}
        {saved && <Button size="small" icon={<ApiOutlined />} loading={checking} onClick={() => void check()}>检测接口</Button>}
        {saved && (
          <Popconfirm title="清除公众号设置？" description="AppID 和 AppSecret 都会从本机删除，之后可以重新填写。" okText="清除" cancelText="取消" onConfirm={() => void clear()}>
            <Button size="small" danger icon={<ClearOutlined />}>一键清除</Button>
          </Popconfirm>
        )}
      </div>
      {saved && health && health.state !== "unset" && (
        <div className="mp-health muted">上次检测 {new Date(health.checkedAt).toLocaleString("zh-CN")}，软件每 6 小时自动检测一次，失效会在通知中心提醒</div>
      )}
      {saved && health && (health.state === "failed" || health.state === "offline") && (
        <Alert
          type={health.state === "failed" ? "error" : "warning"}
          showIcon
          message={health.message}
          description={
            health.code === 40164 || health.code === 61004
              ? "家宽的公网 IP 一般几天变一次，变了这里就会连不上。到公众号后台把新 IP 加进白名单，回来点「检测接口」即可，AppID 和 AppSecret 不用重填。"
              : undefined
          }
        />
      )}
      <div className="mp-cred">
        <Input placeholder={saved ? "新 AppID（覆盖 " + saved + "）" : "AppID（wx 开头）"} value={appId} onChange={(e) => setAppId(e.target.value)} allowClear />
        <Input.Password placeholder="AppSecret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
      </div>
      <div className="mp-actions">
        <Button type="primary" loading={busy} disabled={!appId.trim() || !secret.trim()} onClick={() => void save()}>
          保存并检测
        </Button>
        {(appId || secret) && <Button onClick={reset}>清空输入</Button>}
      </div>
      <p className="muted">在公众号后台「设置与开发 → 基本配置」里拿 AppID 和 AppSecret，并把下面「本机 IP」里的公网 IP 加进「IP 白名单」。需要认证过的公众号。保存时会顺手检测一次，<b>连不上也照样保存</b>：家宽 IP 变了只要去后台更新白名单，回来点「检测接口」，不用重新填。AppSecret 加密存在本机，不上传。</p>
    </div>
  );
}
