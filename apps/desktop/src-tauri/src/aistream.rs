//! AI 改寫的串流回應解析（ADR-0416）。
//!
//! 兩種 provider 的串流格式：
//!   - Ollama `/api/generate`（`stream: true`）：每行一個 JSON（NDJSON），`response` 是這一段文字，
//!     `done: true` 是最後一行；出錯時是 `{"error": "..."}`。
//!   - OpenAI 相容 `/v1/chat/completions`（`stream: true`）：SSE，`data: {...}` 的
//!     `choices[0].delta.content` 是這一段文字，`data: [DONE]` 結束。
//!
//! 網路送來的位元組可能把一行（甚至一個 UTF-8 字元）切在兩塊中間，所以先按 `\n` 收齊整行
//! 再解碼。純 std＋serde_json，**無 feature 閘門**，`cargo test` 預設就測得到。

/// 串流的 provider 格式。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamFormat {
    /// Ollama NDJSON。
    Ollama,
    /// OpenAI 相容 SSE。
    OpenAi,
}

impl StreamFormat {
    /// 由 provider 名稱決定格式（與 `ai_generate` 同一規則：不是 `openai` 就是 Ollama）。
    pub fn of(provider: &str) -> Self {
        if provider == "openai" {
            StreamFormat::OpenAi
        } else {
            StreamFormat::Ollama
        }
    }
}

/// 逐塊餵入回應位元組，吐出文字片段。
#[derive(Debug)]
pub struct StreamDecoder {
    format: StreamFormat,
    buf: Vec<u8>,
    done: bool,
}

impl StreamDecoder {
    pub fn new(format: StreamFormat) -> Self {
        StreamDecoder { format, buf: Vec::new(), done: false }
    }

    /// 是否已收到結束標記（Ollama `done: true`／OpenAI `[DONE]`）。
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// 餵入一塊位元組，回傳這塊湊出的完整行裡的文字片段（可能是空的）。
    /// provider 回報錯誤時回 `Err`。
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            self.line(&line[..line.len() - 1], &mut out)?;
        }
        Ok(out)
    }

    /// 回應結束：處理最後一行沒有換行的殘餘。
    pub fn finish(&mut self) -> Result<Vec<String>, String> {
        let rest = std::mem::take(&mut self.buf);
        let mut out = Vec::new();
        self.line(&rest, &mut out)?;
        Ok(out)
    }

    fn line(&mut self, raw: &[u8], out: &mut Vec<String>) -> Result<(), String> {
        if self.done {
            return Ok(());
        }
        let text = String::from_utf8_lossy(raw);
        let line = text.trim();
        if line.is_empty() {
            return Ok(());
        }
        match self.format {
            StreamFormat::Ollama => {
                let v: serde_json::Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => return Ok(()), // 看不懂的行略過，不讓一行雜訊毀掉整段
                };
                if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                    return Err(format!("ollama: {err}"));
                }
                if let Some(s) = v.get("response").and_then(|r| r.as_str()) {
                    if !s.is_empty() {
                        out.push(s.to_string());
                    }
                }
                if v.get("done").and_then(|d| d.as_bool()) == Some(true) {
                    self.done = true;
                }
            }
            StreamFormat::OpenAi => {
                let Some(data) = line.strip_prefix("data:") else {
                    return Ok(()); // SSE 的 event:/id:/註解行
                };
                let data = data.trim();
                if data == "[DONE]" {
                    self.done = true;
                    return Ok(());
                }
                let v: serde_json::Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => return Ok(()),
                };
                if let Some(msg) = v.get("error").and_then(|e| e.get("message").or(Some(e))).and_then(|m| m.as_str()) {
                    return Err(format!("openai: {msg}"));
                }
                if let Some(s) = v["choices"][0]["delta"]["content"].as_str() {
                    if !s.is_empty() {
                        out.push(s.to_string());
                    }
                }
            }
        }
        Ok(())
    }
}

/// Ollama `/api/generate` 的請求本體。`think: false`：會思考的模型（gemma4、qwen3…）預設先默默推理，
/// CPU 上要等一分鐘才吐第一個字；改寫用不到那段推理（ADR-0416 實機：56 秒 → 5 秒）。不支援思考的模型忽略這格。
pub fn ollama_body(model: &str, prompt: &str, stream: bool) -> serde_json::Value {
    serde_json::json!({ "model": model, "prompt": prompt, "stream": stream, "think": false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_body_turns_off_thinking() {
        // 會「思考」的模型（gemma4、qwen3…）在 CPU 上先默默想一分鐘才吐字；改寫用不到（ADR-0416 實機）
        for stream in [false, true] {
            let b = ollama_body("gemma4:e4b", "改客氣", stream);
            assert_eq!(b["model"], "gemma4:e4b");
            assert_eq!(b["prompt"], "改客氣");
            assert_eq!(b["stream"], stream);
            assert_eq!(b["think"], false);
        }
    }

    fn all(format: StreamFormat, chunks: &[&[u8]]) -> Result<String, String> {
        let mut d = StreamDecoder::new(format);
        let mut s = String::new();
        for c in chunks {
            s.extend(d.push(c)?);
        }
        s.extend(d.finish()?);
        Ok(s)
    }

    #[test]
    fn ollama_ndjson_concatenates_responses_and_sees_done() {
        let body = b"{\"response\":\"\xe4\xbd\xa0\",\"done\":false}\n{\"response\":\"\xe5\xa5\xbd\",\"done\":false}\n{\"response\":\"\",\"done\":true}\n";
        let mut d = StreamDecoder::new(StreamFormat::Ollama);
        let got: String = d.push(body).unwrap().concat();
        assert_eq!(got, "你好");
        assert!(d.is_done());
    }

    #[test]
    fn line_and_utf8_char_split_across_chunks() {
        // 「你」是 e4 bd a0：切在字元中間，也切在行中間。
        let a: &[u8] = b"{\"response\":\"\xe4\xbd";
        let b: &[u8] = b"\xa0\",\"done\":false}\n{\"resp";
        let c: &[u8] = b"onse\":\"!\",\"done\":true}";
        assert_eq!(all(StreamFormat::Ollama, &[a, b, c]).unwrap(), "你!");
    }

    #[test]
    fn ollama_error_line_is_err() {
        let r = all(StreamFormat::Ollama, &[b"{\"error\":\"model not found\"}\n"]);
        assert_eq!(r.unwrap_err(), "ollama: model not found");
    }

    #[test]
    fn garbage_lines_are_skipped() {
        assert_eq!(all(StreamFormat::Ollama, &[b"not json\n{\"response\":\"ok\"}\n"]).unwrap(), "ok");
    }

    #[test]
    fn openai_sse_reads_delta_content_until_done() {
        let body = b": keep-alive\n\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\ndata: [DONE]\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n";
        let mut d = StreamDecoder::new(StreamFormat::OpenAi);
        let got: String = d.push(body).unwrap().concat();
        assert_eq!(got, "Hi there");
        assert!(d.is_done(), "[DONE] 之後的資料不再收");
    }

    #[test]
    fn openai_error_object_is_err() {
        let r = all(StreamFormat::OpenAi, &[b"data: {\"error\":{\"message\":\"bad key\"}}\n"]);
        assert_eq!(r.unwrap_err(), "openai: bad key");
    }

    #[test]
    fn format_of_provider() {
        assert_eq!(StreamFormat::of("openai"), StreamFormat::OpenAi);
        assert_eq!(StreamFormat::of("ollama"), StreamFormat::Ollama);
        assert_eq!(StreamFormat::of("whatever"), StreamFormat::Ollama);
    }
}
