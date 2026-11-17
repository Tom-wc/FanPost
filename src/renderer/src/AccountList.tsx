import { useMemo, useState } from "react";
import { Button, Input, Modal, Tooltip, message } from "antd";
import { DeleteOutlined, DownOutlined, EditOutlined } from "@ant-design/icons";
import type { Account, AppData, Platform } from "../../shared/types";
import { platformMap, platforms } from "../../shared/platforms";
import { REMARK_MAX, accountLabel, accountWho } from "../../shared/accounts";
import { PlatformLogo } from "./PlatformLogo";
import { useCollapsed } from "./collapse";

const statusText = { logged_in: "在线", logged_out: "已掉线" };

export function AccountList({
  data,
  active,
  onChoose,
  onRemoved,
  setData,
  hideBrowser,
  restoreBrowser,
}: {
  data: AppData;
  active?: string;
  onChoose: (a: Account) => void;
  onRemoved: (id: string) => Promise<void>;
  setData: (d: AppData) => void;
  hideBrowser: () => Promise<void>;
  restoreBrowser: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Account>();
  const [remark, setRemark] = useState("");
  const [removing, setRemoving] = useState<Account>();
  const collapse = useCollapsed("side");
  const groups = useMemo(() => {
    const order = new Map(platforms.map((p, i) => [p.id, i]));
    const map = new Map<Platform, Account[]>();
    for (const a of data.accounts) map.set(a.platform, [...(map.get(a.platform) || []), a]);
    return Array.from(map.entries()).sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  }, [data.accounts]);
  const openEdit = async (a: Account) => {
    await hideBrowser();
    setRemark(a.remark || "");
    setEditing(a);
  };
  const openRemove = async (a: Account) => {
    await hideBrowser();
    setRemoving(a);
  };
  const closeModal = async () => {
    setEditing(undefined);
    setRemoving(undefined);
    await restoreBrowser();
  };
  const saveRemark = async () => {
    if (!editing) return;
    try {
      setData(await window.fanpost.updateAccount(editing.id, { remark }));
      await closeModal();
    } catch (error) {
      message.error("保存备注失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const confirmRemove = async () => {
    if (!removing) return;
    const id = removing.id;
    setRemoving(undefined);
    try {
      await onRemoved(id);
      setData(await window.fanpost.removeAccount(id));
      message.success("已删除账号并清除本机登录数据");
    } catch (error) {
      message.error("删除失败：" + (error instanceof Error ? error.message : String(error)));
    }
    await restoreBrowser();
  };
  let index = 0;
  const row = (a: Account, child: boolean) => (
    <div
      role="button"
      tabIndex={0}
      className={"account" + (child ? " is-child" : "") + (active === a.id ? " active" : "")}
      key={a.id}
      style={{ animationDelay: index++ * 30 + "ms" }}
      onClick={() => onChoose(a)}
      onKeyDown={(e) => e.key === "Enter" && onChoose(a)}
    >
      {child ? <span className={"account-avatar is-" + a.loginStatus}>{Array.from(accountLabel(a).replace(/^@/, ""))[0]}</span> : <PlatformLogo platform={a.platform} />}
      <span className="account-text">
        <b>{accountLabel(a)}</b>
        <small>
          <i className={"dot is-" + a.loginStatus} />
          {child ? (a.remark ? a.name + " · " : "") : (a.remark ? a.name : platformMap[a.platform].name) + " · "}
          {statusText[a.loginStatus]}
        </small>
      </span>
      <span className="account-actions">
        <Tooltip title="备注">
          <Button type="text" size="small" icon={<EditOutlined />} aria-label="编辑备注" onClick={(e) => { e.stopPropagation(); void openEdit(a); }} />
        </Tooltip>
        <Tooltip title="删除账号">
          <Button className="account-del" type="text" size="small" icon={<DeleteOutlined />} aria-label="删除账号" onClick={(e) => { e.stopPropagation(); void openRemove(a); }} />
        </Tooltip>
      </span>
    </div>
  );
  return (
    <>
      <div className="account-list">
        {groups.map(([platform, list]) => {
          if (list.length === 1) return row(list[0], false);
          const online = list.filter((a) => a.loginStatus === "logged_in").length;
          const lost = list.filter((a) => a.loginStatus === "logged_out").length;
          const hasActive = list.some((a) => a.id === active);
          const closed = collapse.isCollapsed(platform) && !hasActive;
          return (
            <div className={"account-cluster" + (closed ? " is-closed" : "")} key={platform}>
              <button
                type="button"
                className="account-cluster-head"
                aria-expanded={!closed}
                onClick={() => collapse.toggle(platform)}
                title={closed ? "展开" : "收起"}
              >
                <PlatformLogo platform={platform} />
                <span className="account-text">
                  <b>{platformMap[platform].name}</b>
                  <small>
                    {list.length} 个账号 · {online} 个在线
                    {lost > 0 && <em className="cluster-lost">{lost} 掉线</em>}
                  </small>
                </span>
                <DownOutlined className="cluster-caret" aria-hidden />
              </button>
              <div className="account-cluster-body" hidden={closed}>{list.map((a) => row(a, true))}</div>
            </div>
          );
        })}
      </div>
      <Modal title={editing ? "备注 · " + accountWho(editing) : ""} open={!!editing} okText="保存" cancelText="取消" onOk={() => void saveRemark()} onCancel={() => void closeModal()} destroyOnHidden>
        <p className="muted modal-tip">同平台有多个账号时用来区分，比如“主号”“门店号”。留空则显示平台读取到的昵称。</p>
        <Input autoFocus value={remark} maxLength={REMARK_MAX} showCount placeholder={editing?.name} onChange={(e) => setRemark(e.target.value)} onPressEnter={() => void saveRemark()} />
      </Modal>
      <Modal
        title={removing ? "删除 " + accountWho(removing) + "？" : ""}
        open={!!removing}
        okText="删除并清除登录"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onOk={() => void confirmRemove()}
        onCancel={() => void closeModal()}
      >
        <p className="modal-tip">会同时删除该账号的发布记录，并清除本机保存的登录 Cookie。平台上的账号本身不受影响，以后可重新扫码添加。</p>
      </Modal>
    </>
  );
}
