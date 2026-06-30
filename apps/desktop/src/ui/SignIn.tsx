import { useState } from "react";

export function SignIn({ onSignIn }: { onSignIn: (name: string) => void }): JSX.Element {
  const [name, setName] = useState("我");
  const submit = () => {
    const n = name.trim();
    if (n) onSignIn(n);
  };
  return (
    <div className="desktop" style={{ justifyContent: "center" }}>
      <div className="win signin">
        <div className="win__title">
          <span>Nostr Buddy</span>
          <span className="spacer" />
        </div>
        <div className="signin__body">
          <div className="signin__logo">🐱</div>
          <h2 style={{ margin: "0 0 4px" }}>登入 Nostr Buddy</h2>
          <p className="hint">去中心化、端到端加密的即時通。輸入顯示名稱即可開始（你的身分是本機生成的 secp256k1 金鑰）。</p>
          <input
            aria-label="顯示名稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="顯示名稱"
          />
          <button onClick={submit}>登入</button>
          <p className="hint">本示範會在記憶體中模擬中繼站與幾位好友，方便你體驗。</p>
        </div>
      </div>
    </div>
  );
}
