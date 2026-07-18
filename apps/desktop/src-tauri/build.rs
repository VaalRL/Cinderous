fn main() {
    // 只有在建置完整 Tauri 二進位（`tauri-app` feature）時才執行 tauri_build，
    // 讓預設的 `cargo test`（僅 lib）不需要 Tauri 工具鏈與 webkit2gtk。
    #[cfg(feature = "tauri-app")]
    {
        // 前端 dist 變動 → 重跑 build script → 強制重編譯／重跑 generate_context! 重嵌前端，
        // 避免「只改前端、exe 卻留舊前端」（ADR-0197）。
        println!("cargo:rerun-if-changed=../dist");
        tauri_build::build();
    }
}
