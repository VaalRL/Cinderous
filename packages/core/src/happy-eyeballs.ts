/** 一個連線嘗試：給定取消訊號，回傳連線結果。 */
export interface ConnectionAttempt<T> {
  label: string;
  connect: (signal: AbortSignal) => Promise<T>;
}

export interface RaceResult<T> {
  /** 勝出嘗試的標籤（如 "lan" / "wan"）。 */
  label: string;
  value: T;
}

/**
 * 同時發起多個連線嘗試（如 LAN 直連與 WAN 打洞），採第一個成功者，
 * 並以 AbortSignal 中止其餘較慢的嘗試（RFC 8305 Happy Eyeballs 精神）。
 * 全部失敗時以 AggregateError 拒絕。
 */
export function raceConnections<T>(attempts: ConnectionAttempt<T>[]): Promise<RaceResult<T>> {
  if (attempts.length === 0) {
    return Promise.reject(new Error("沒有任何連線嘗試"));
  }

  const controller = new AbortController();
  let remaining = attempts.length;
  const errors: unknown[] = [];

  return new Promise<RaceResult<T>>((resolve, reject) => {
    for (const attempt of attempts) {
      attempt.connect(controller.signal).then(
        (value) => {
          controller.abort();
          resolve({ label: attempt.label, value });
        },
        (error) => {
          errors.push(error);
          remaining -= 1;
          if (remaining === 0) {
            reject(new AggregateError(errors, "所有連線嘗試皆失敗"));
          }
        },
      );
    }
  });
}
