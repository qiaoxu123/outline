import * as React from "react";
import { toast } from "sonner";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import SettingRow from "./SettingRow";

interface WebdavStatus {
  configured: boolean;
  source: "local" | "environment" | "none";
  secureStorageAvailable: boolean;
}

interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: { message?: string };
}

interface WebdavDesktopBridge {
  webdavStatus?: () => Promise<IpcResult<WebdavStatus>>;
  webdavSetCredentials?: (
    username: string,
    password: string
  ) => Promise<IpcResult<WebdavStatus>>;
  webdavClearCredentials?: () => Promise<IpcResult<WebdavStatus>>;
}

/** Desktop-only setting. Credentials remain in the Electron main process. */
export default function DesktopWebdavSettings() {
  const bridge = (
    window as Window & { DesktopBridge?: WebdavDesktopBridge }
  ).DesktopBridge;
  const [status, setStatus] = React.useState<WebdavStatus | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    if (!bridge?.webdavStatus) return;
    void bridge.webdavStatus().then(
      (response) => {
        if (!cancelled && response.ok && response.data) setStatus(response.data);
        else if (!cancelled) setError(response.error?.message || "无法读取 WebDAV 配置");
      },
      () => {
        if (!cancelled) setError("无法读取 WebDAV 配置");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Leave official browser-based Outline settings entirely unchanged.
  if (!bridge?.webdavStatus || !bridge.webdavSetCredentials ||
      !bridge.webdavClearCredentials) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const result = await bridge.webdavSetCredentials!(username.trim(), password);
      if (!result.ok || !result.data) throw new Error(result.error?.message || "保存失败");
      setStatus(result.data);
      setPassword("");
      toast.success("WebDAV 凭据已加密保存到本机");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await bridge.webdavClearCredentials!();
      if (!result.ok || !result.data) throw new Error(result.error?.message || "清除失败");
      setStatus(result.data);
      setUsername("");
      setPassword("");
      toast.success("已清除本机 WebDAV 凭据");
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  };

  const description = status?.configured
    ? status.source === "local"
      ? "已启用（系统加密存储）"
      : "已启用（通过环境变量配置）"
    : "尚未配置";
  return (
    <>
      <Heading as="h2">桌面端同步</Heading>
      <SettingRow
        name="desktop-webdav"
        label="WebDAV 同步凭据"
        description={`论文库互动、随记和自测数据的同步。当前状态：${description}。密码不会展示或写入 Outline 文档。`}
      >
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 320 }}>
          <input
            id="desktop-webdav"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="WebDAV 用户名 / 邮箱"
            aria-label="WebDAV 用户名"
            disabled={busy}
            style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #aeb6bf" }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="WebDAV 应用专用密码"
            aria-label="WebDAV 应用专用密码"
            disabled={busy}
            style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #aeb6bf" }}
          />
          {!status?.secureStorageAvailable && (
            <span role="status" style={{ fontSize: 12 }}>
              系统安全存储不可用，请启用密钥环，或使用环境变量配置。
            </span>
          )}
          {error && <span role="alert" style={{ fontSize: 12, color: "#c92a2a" }}>{error}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button type="submit" disabled={busy || !username.trim() || !password || !status?.secureStorageAvailable}>
              保存
            </Button>
            {status?.source === "local" && (
              <Button type="button" neutral disabled={busy} onClick={() => void clear()}>
                清除
              </Button>
            )}
          </div>
        </form>
      </SettingRow>
    </>
  );
}
