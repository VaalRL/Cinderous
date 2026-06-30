import { useEffect, useMemo, useState } from "react";
import { FriendList } from "./FriendList.js";
import { PresenceStore, type Friend, type HeartbeatLike } from "./presence-store.js";

export interface AppProps {
  /** 初始好友清單（之後由本機 SQLite 提供）。 */
  friends?: Friend[];
  /**
   * 心跳事件來源。Tauri 後端透過 IPC 將 relay 收到的已驗證事件推送至前端
   * （T11）；測試或瀏覽器預覽時可注入替身。回傳取消訂閱函式。
   */
  subscribeHeartbeats?: (onEvent: (e: HeartbeatLike) => void) => () => void;
}

export function App({ friends = [], subscribeHeartbeats }: AppProps): JSX.Element {
  const store = useMemo(() => new PresenceStore(friends), [friends]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const unsub = subscribeHeartbeats?.((e) => {
      store.ingestEvent(e);
      setNow(Date.now());
    });
    return () => {
      clearInterval(tick);
      unsub?.();
    };
  }, [store, subscribeHeartbeats]);

  return (
    <main className="app">
      <h1>Nostr Buddy</h1>
      <FriendList friends={store.view(now)} />
    </main>
  );
}
