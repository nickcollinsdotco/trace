//! Downloading and extracting models.
//!
//! Downloads stream to a temporary file and are only moved into place once
//! complete, so an interrupted transfer can never leave a half-written model
//! that looks installed.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;

use super::{missing_files, model_dir, ModelError, ModelSpec};

/// Progress during installation.
#[derive(Debug, Clone, Copy)]
pub enum Progress {
    /// Bytes downloaded so far, and the total if the server reported one.
    Downloading {
        received: u64,
        total: Option<u64>,
    },
    Extracting,
    Verifying,
    Done,
}

impl Progress {
    /// Completion in 0.0..=1.0, where known.
    pub fn fraction(&self) -> Option<f64> {
        match self {
            Progress::Downloading {
                received,
                total: Some(total),
            } if *total > 0 => Some((*received as f64 / *total as f64).min(1.0)),
            Progress::Done => Some(1.0),
            _ => None,
        }
    }
}

/// Download and install `spec`, reporting progress.
///
/// A no-op when the model is already complete, so it is safe to call on every
/// launch.
pub fn install(spec: &ModelSpec, mut on_progress: impl FnMut(Progress)) -> Result<(), ModelError> {
    let dir = model_dir(spec)?;
    if missing_files(spec, &dir).is_empty() {
        on_progress(Progress::Done);
        return Ok(());
    }

    fs::create_dir_all(&dir)?;

    // Staged alongside the target directory, not in the system temp dir: a
    // 478 MB cross-volume move would be a full copy, and %TEMP% is not
    // guaranteed to be on the same drive.
    let staging = dir.with_extension("partial.tar.gz");
    if staging.exists() {
        fs::remove_file(&staging)?;
    }

    download(spec.archive_url, &staging, &mut on_progress)?;

    on_progress(Progress::Extracting);
    let extract_result = extract_into(&staging, &dir);

    // Always remove the archive, including on failure — leaving half a
    // gigabyte of rubbish behind after an error is its own bug.
    fs::remove_file(&staging).ok();
    extract_result?;

    on_progress(Progress::Verifying);
    let missing = missing_files(spec, &dir);
    if !missing.is_empty() {
        return Err(ModelError::Incomplete {
            name: spec.id,
            missing: missing.join(", "),
        });
    }

    on_progress(Progress::Done);
    Ok(())
}

fn download(
    url: &str,
    dest: &Path,
    on_progress: &mut impl FnMut(Progress),
) -> Result<(), ModelError> {
    let response = ureq::get(url)
        .call()
        .map_err(|e| ModelError::Download(format!("{url}: {e}")))?;

    let total = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let mut reader = response.into_body().into_reader();
    let mut file = File::create(dest)?;

    // 1 MiB buffer: large enough that a ~500 MB download is not dominated by
    // syscall overhead, small enough to report progress smoothly.
    let mut buf = vec![0u8; 1024 * 1024];
    let mut received: u64 = 0;

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        received += n as u64;
        on_progress(Progress::Downloading { received, total });
    }

    file.flush()?;

    // A truncated transfer that ends cleanly would otherwise be extracted and
    // fail with a confusing gzip error instead of a clear download error.
    if let Some(total) = total {
        if received != total {
            return Err(ModelError::Download(format!(
                "expected {total} bytes, received {received}"
            )));
        }
    }

    Ok(())
}

/// Extract a gzipped tarball, flattening any single top-level directory.
///
/// Archives from different sources disagree about whether they wrap their
/// contents in a folder. Flattening means the model files land directly in
/// `dir` either way, which is what `ParakeetModel::load` expects.
fn extract_into(archive: &Path, dir: &Path) -> Result<(), ModelError> {
    let file = File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(io::BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);

    for entry in tar
        .entries()
        .map_err(|e| ModelError::Extract(e.to_string()))?
    {
        let mut entry = entry.map_err(|e| ModelError::Extract(e.to_string()))?;
        let path = entry
            .path()
            .map_err(|e| ModelError::Extract(e.to_string()))?
            .into_owned();

        // Keep only the file name. This also defends against path traversal
        // (`../..`) in a malicious or malformed archive.
        let Some(name) = path.file_name() else {
            continue;
        };
        if entry.header().entry_type().is_dir() {
            continue;
        }

        let out_path = dir.join(name);
        entry
            .unpack(&out_path)
            .map_err(|e| ModelError::Extract(format!("{}: {e}", out_path.display())))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fraction_is_known_only_when_the_total_is() {
        assert_eq!(
            Progress::Downloading {
                received: 50,
                total: Some(200)
            }
            .fraction(),
            Some(0.25)
        );
        assert_eq!(
            Progress::Downloading {
                received: 50,
                total: None
            }
            .fraction(),
            None
        );
        assert_eq!(Progress::Done.fraction(), Some(1.0));
        assert_eq!(Progress::Extracting.fraction(), None);
    }

    #[test]
    fn fraction_never_exceeds_one() {
        // Servers do occasionally under-report content-length.
        let p = Progress::Downloading {
            received: 300,
            total: Some(200),
        };
        assert_eq!(p.fraction(), Some(1.0));
    }

    #[test]
    fn zero_total_does_not_divide_by_zero() {
        let p = Progress::Downloading {
            received: 0,
            total: Some(0),
        };
        assert_eq!(p.fraction(), None);
    }
}
