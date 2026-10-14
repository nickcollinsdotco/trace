//! Just enough HTTP to stream one request from Ollama and hang up on it.
//!
//! Every other call to Ollama goes through `ureq`. This one cannot: Stop has
//! to work while the model is still loading, which is when Ollama has sent
//! nothing back and `ureq` is blocked waiting for headers, with no way for
//! another thread to close its socket. Ollama abandons a load or a
//! generation the moment its client goes away — measured, see
//! `examples/stop_check.rs` — so being able to go away is the whole point.
//!
//! Hanging up cannot be done by shutting the socket from another thread: on
//! Windows that does not wake a read already blocked on it (tried; the read
//! sat out its whole timeout). So reads wait in short slices and look at a
//! flag between them, and the connection is dropped on the reading thread.
//! The rest is what Ollama actually sends to a local client: a status line,
//! headers, and a body that is either chunked (the stream) or sized (an
//! error).

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long one read waits before looking at the hang-up flag. The most a
/// hang-up can take to reach Ollama.
const SLICE: Duration = Duration::from_millis(200);

/// Hangs up from another thread.
pub struct HangUp(Arc<AtomicBool>);

impl HangUp {
    pub fn now(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// An open connection, not yet sent anything.
pub struct Connection {
    stream: TcpStream,
    host: String,
    hung_up: Arc<AtomicBool>,
    idle: Duration,
}

pub struct Response {
    pub status: u16,
    pub body: Box<dyn BufRead + Send>,
}

/// Connect, and hand back what will hang up on it.
///
/// `idle` bounds each wait for more of the answer rather than the whole of
/// it: a long summary that keeps producing is fine, one that has gone quiet
/// for that long is not.
pub fn connect(host: &str, idle: Duration) -> io::Result<(Connection, HangUp)> {
    let stream = TcpStream::connect(host)?;
    stream.set_read_timeout(Some(SLICE))?;
    let hung_up = Arc::new(AtomicBool::new(false));
    Ok((
        Connection {
            stream,
            host: host.to_string(),
            hung_up: Arc::clone(&hung_up),
            idle,
        },
        HangUp(hung_up),
    ))
}

impl Connection {
    /// POST a JSON body and read the response head. Blocks until Ollama
    /// answers — through the whole model load — or it is hung up on.
    pub fn post_json(mut self, path: &str, body: &[u8]) -> io::Result<Response> {
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n",
            self.host,
            body.len()
        );
        self.stream.write_all(head.as_bytes())?;
        self.stream.write_all(body)?;
        self.stream.flush()?;
        read_response(BufReader::new(Patient {
            stream: self.stream,
            hung_up: self.hung_up,
            idle: self.idle,
        }))
    }
}

/// A socket read that waits in slices, giving up when hung up on or when
/// nothing has come for `idle`. Dropping it closes the connection.
struct Patient {
    stream: TcpStream,
    hung_up: Arc<AtomicBool>,
    idle: Duration,
}

impl Read for Patient {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let since = Instant::now();
        loop {
            if self.hung_up.load(Ordering::Relaxed) {
                return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "hung up"));
            }
            match self.stream.read(buf) {
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) =>
                {
                    if since.elapsed() >= self.idle {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "Ollama sent nothing for too long",
                        ));
                    }
                }
                other => return other,
            }
        }
    }
}

fn read_response<R: BufRead + Send + 'static>(mut reader: R) -> io::Result<Response> {
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| invalid(format!("not an HTTP response: {:?}", line.trim())))?;

    let mut chunked = false;
    let mut length: Option<u64> = None;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Err(invalid("the response ended inside its headers".into()));
        }
        let header = line.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            let (name, value) = (name.trim(), value.trim());
            if name.eq_ignore_ascii_case("transfer-encoding") {
                chunked = value.to_ascii_lowercase().contains("chunked");
            } else if name.eq_ignore_ascii_case("content-length") {
                length = value.parse().ok();
            }
        }
    }

    let body: Box<dyn BufRead + Send> = if chunked {
        Box::new(BufReader::new(Chunked {
            inner: reader,
            left: 0,
            done: false,
        }))
    } else if let Some(length) = length {
        Box::new(reader.take(length))
    } else {
        // `Connection: close` was asked for, so the end of the body is the
        // end of the connection.
        Box::new(reader)
    };
    Ok(Response { status, body })
}

/// A chunked body, decoded.
struct Chunked<R> {
    inner: R,
    /// Bytes still to read of the current chunk.
    left: usize,
    done: bool,
}

impl<R: BufRead> Read for Chunked<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.done || buf.is_empty() {
            return Ok(0);
        }
        if self.left == 0 {
            let mut size = String::new();
            if self.inner.read_line(&mut size)? == 0 {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            // Extensions after `;` are allowed and mean nothing here.
            let hex = size.split(';').next().unwrap_or_default().trim();
            self.left = usize::from_str_radix(hex, 16)
                .map_err(|_| invalid(format!("bad chunk size {hex:?}")))?;
            if self.left == 0 {
                self.done = true;
                return Ok(0);
            }
        }
        let want = buf.len().min(self.left);
        let n = self.inner.read(&mut buf[..want])?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        self.left -= n;
        if self.left == 0 {
            let mut crlf = [0u8; 2];
            self.inner.read_exact(&mut crlf)?;
        }
        Ok(n)
    }
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn response(raw: &str) -> Response {
        read_response(Cursor::new(raw.as_bytes().to_vec())).unwrap()
    }

    fn lines(r: Response) -> Vec<String> {
        r.body.lines().map(Result::unwrap).collect()
    }

    #[test]
    fn a_chunked_stream_decodes_to_its_lines() {
        // Chunk boundaries fall mid-line, as they do from Ollama.
        let r = response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\
             Transfer-Encoding: chunked\r\n\r\n\
             8\r\n{\"a\":1}\n\r\n\
             5\r\n{\"b\":\r\n\
             3\r\n2}\n\r\n\
             0\r\n\r\n",
        );
        assert_eq!(r.status, 200);
        assert_eq!(lines(r), vec![r#"{"a":1}"#, r#"{"b":2}"#]);
    }

    #[test]
    fn an_error_status_keeps_its_sized_body() {
        let r = response(
            "HTTP/1.1 400 Bad Request\r\nContent-Length: 17\r\n\r\n{\"error\":\"nope\"}\ntrailing",
        );
        assert_eq!(r.status, 400);
        assert_eq!(lines(r), vec![r#"{"error":"nope"}"#]);
    }

    #[test]
    fn chunk_extensions_are_ignored() {
        let r = response(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3;x=y\r\nhi\n\r\n0\r\n\r\n",
        );
        assert_eq!(lines(r), vec!["hi"]);
    }

    #[test]
    fn a_stream_cut_off_mid_chunk_is_an_error_not_a_short_answer() {
        let r = response("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\na\r\nabc");
        let mut out = String::new();
        assert!(r.body.take(100).read_to_string(&mut out).is_err());
    }

    #[test]
    fn garbage_is_not_taken_for_a_response() {
        assert!(read_response(Cursor::new(b"hello\r\n\r\n".to_vec())).is_err());
    }

    #[test]
    fn hanging_up_unblocks_a_read_on_another_thread() {
        // A listener that accepts and never answers: Ollama loading a model.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let server = std::thread::spawn(move || listener.accept().map(|(s, _)| s));

        let (conn, hang_up) = connect(&addr, Duration::from_secs(30)).unwrap();
        let reader = std::thread::spawn(move || conn.post_json("/api/generate", b"{}"));
        std::thread::sleep(Duration::from_millis(200));

        let pressed = std::time::Instant::now();
        hang_up.now();
        assert!(reader.join().unwrap().is_err());
        assert!(
            pressed.elapsed() < Duration::from_secs(2),
            "the read did not let go"
        );
        drop(server);
    }
}
