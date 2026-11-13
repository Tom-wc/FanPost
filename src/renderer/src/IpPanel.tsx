import { useEffect, useState } from "react";
import { Button, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { IpInfo } from "../../main/public-ip";

export function IpPanel() {
  const [info, setInfo] = useState<IpInfo>();
  const [busy, setBusy] = useState(false);
  const load = async (force: boolean) => {
    setBusy(true);
    try {
      setInfo(await window.fanpost.getIp(force));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load(false);
  }, []);
  return (
    <div className="ip-panel">
      <div className="license-row">
        <span>公网 IP</span>
        {info?.publicIp ? <Typography.Text copyable code className="num">{info.publicIp}</Typography.Text> : <span className="muted">{busy ? "正在查询…" : info?.error || "—"}</span>}
        <Button size="small" type="text" icon={<ReloadOutlined />} loading={busy} onClick={() => void load(true)} aria-label="重新查询" />
      </div>
      {!!info?.localIps.length && (
        <div className="license-row">
          <span>局域网 IP</span>
          <span className="num muted">{info.localIps.join("、")}</span>
        </div>
      )}
      <p className="muted">每次启动自动查询。公众号「IP 白名单」要填公网 IP；换了网络（如家里和公司）要重新加。家宽的公网 IP 通常几天变一次，变了只需回来更新白名单，公众号的 AppID 和 AppSecret 不用重填。</p>
    </div>
  );
}
