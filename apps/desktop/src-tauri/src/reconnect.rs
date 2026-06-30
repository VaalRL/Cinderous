//! relay 連線的重連退避邏輯（與平台無關，便於單元測試）。

use std::time::Duration;

/// 連線狀態機的狀態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
}

/// 指數退避：`base * 2^attempt`，上限為 `max`。
///
/// 連線成功時呼叫 [`Backoff::reset`]；每次重試前呼叫 [`Backoff::next_delay`]。
#[derive(Debug, Clone)]
pub struct Backoff {
    base: Duration,
    max: Duration,
    attempt: u32,
}

impl Backoff {
    pub fn new(base: Duration, max: Duration) -> Self {
        Self { base, max, attempt: 0 }
    }

    /// 連線成功後重置退避序列。
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    /// 取得下一次重試前應等待的時間，並遞增嘗試次數（封頂於 `max`）。
    pub fn next_delay(&mut self) -> Duration {
        let factor = 2u64.saturating_pow(self.attempt);
        let millis = self.base.as_millis() as u64;
        let delay = Duration::from_millis(millis.saturating_mul(factor));
        self.attempt = self.attempt.saturating_add(1);
        delay.min(self.max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponential_sequence_capped_at_max() {
        let mut b = Backoff::new(Duration::from_secs(1), Duration::from_secs(8));
        assert_eq!(b.next_delay(), Duration::from_secs(1));
        assert_eq!(b.next_delay(), Duration::from_secs(2));
        assert_eq!(b.next_delay(), Duration::from_secs(4));
        assert_eq!(b.next_delay(), Duration::from_secs(8));
        // 封頂後維持 max
        assert_eq!(b.next_delay(), Duration::from_secs(8));
        assert_eq!(b.next_delay(), Duration::from_secs(8));
    }

    #[test]
    fn reset_restarts_sequence() {
        let mut b = Backoff::new(Duration::from_secs(1), Duration::from_secs(30));
        b.next_delay();
        b.next_delay();
        b.reset();
        assert_eq!(b.next_delay(), Duration::from_secs(1));
    }

    #[test]
    fn does_not_overflow_after_many_attempts() {
        let mut b = Backoff::new(Duration::from_secs(2), Duration::from_secs(60));
        for _ in 0..128 {
            assert!(b.next_delay() <= Duration::from_secs(60));
        }
    }

    #[test]
    fn connection_state_equality() {
        assert_eq!(ConnectionState::Connected, ConnectionState::Connected);
        assert_ne!(ConnectionState::Connecting, ConnectionState::Disconnected);
    }
}
