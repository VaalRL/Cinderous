fn main() {
    // 只有在建置完整 Tauri 二進位（`tauri-app` feature）時才執行 tauri_build，
    // 讓預設的 `cargo test`（僅 lib）不需要 Tauri 工具鏈與 webkit2gtk。
    #[cfg(feature = "tauri-app")]
    tauri_build::build();
}
