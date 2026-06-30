import type { FriendView } from "./presence-store.js";

/** 好友列表呈現層：依上線/離線狀態渲染（MSN 風格綠/灰）。 */
export function FriendList({ friends }: { friends: FriendView[] }): JSX.Element {
  return (
    <ul className="friend-list">
      {friends.map((f) => (
        <li key={f.pubkey} className={`friend friend--${f.status}`}>
          <span
            className="friend__dot"
            aria-label={f.status === "online" ? "上線" : "離線"}
          />
          <span className="friend__name">{f.name}</span>
        </li>
      ))}
    </ul>
  );
}
