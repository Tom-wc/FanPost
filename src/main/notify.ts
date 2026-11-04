import { BrowserWindow, Notification } from "electron";
import { randomUUID } from "node:crypto";
import type { JsonStore } from "./store";
import { writeBrowserLog } from "./log-bus";
import { pushNotification, wantsSystemToast, type NotificationInput } from "./notify-core";

export class Notifier {
  constructor(
    private store: JsonStore,
    private getWin: () => BrowserWindow | null,
  ) {}
  async notify(input: NotificationInput, options: { system?: boolean } = {}) {
    await this.store.update((d) => {
      pushNotification(d, input, randomUUID(), new Date().toISOString());
    });
    const win = this.getWin();
    win?.webContents.send("data:changed");
    win?.webContents.send("notification:new", input);
    const wantsSystem = wantsSystemToast(this.store.get().settings.systemNotify, input, options.system);
    const focused = !!win && !win.isDestroyed() && win.isFocused();
    if (wantsSystem && !focused && Notification.isSupported()) {
      try {
        const toast = new Notification({ title: input.title, body: input.message.slice(0, 200) });
        toast.on("click", () => {
          const w = this.getWin();
          if (!w || w.isDestroyed()) return;
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
          w.webContents.send("notification:open");
        });
        toast.show();
      } catch (error) {
        void writeBrowserLog("system-notification-error " + String(error));
      }
    }
  }
  markRead(ids: string[] | "all") {
    return this.store.update((d) => {
      for (const n of d.notifications)
        if (ids === "all" || ids.includes(n.id)) n.read = true;
    });
  }
  clearRead() {
    return this.store.update((d) => {
      d.notifications = d.notifications.filter((n) => !n.read);
    });
  }
}
