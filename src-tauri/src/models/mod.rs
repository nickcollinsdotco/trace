//! Local model storage and installation.
//!
//! Models live outside the project, under the OS's per-user data directory:
//!
//! ```text
//! Windows  %LOCALAPPDATA%\TRACE\models\
//! macOS    ~/Library/Application Support/TRACE/models/
//! ```
//!
//! Deliberately *not* in the repository. The Parakeet download is ~478 MB, so
//! a project-local directory would mean re-downloading on every fresh clone
//! and would sit awkwardly next to source control. This is also where a
//! shipped application would keep them.
//!
//! Nothing is bundled with the binary — every model is fetched on first use.
//! That download is the real work behind the boot sequence in
//! `docs/09-EASTER-EGGS.md`: the `[ OK ] TRANSCRIPTION ENGINE` screen is an
//! honest progress UI, not decoration.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub mod install;

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("could not determine the local data directory")]
    NoDataDir,
    #[error("model '{0}' is not installed")]
    NotInstalled(&'static str),
    #[error("download failed: {0}")]
    Download(String),
    #[error("archive extraction failed: {0}")]
    Extract(String),
    #[error("model '{name}' is incomplete: missing {missing}")]
    Incomplete { name: &'static str, missing: String },
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

/// Windows: ERROR_DISK_FULL. Checked by code because the message is localised.
#[cfg(windows)]
const ERROR_DISK_FULL: i32 = 112;

impl ModelError {
    /// What to tell the user, and what they can do about it.
    ///
    /// The `Display` text is the technical truth and belongs in a log. It is
    /// the wrong thing to put on a first-run screen: "download failed:
    /// https://…: Dns Failed" tells someone with no internet connection
    /// nothing they can act on. This is the same failure, said usefully.
    ///
    /// The technical detail is appended rather than discarded — a bug report
    /// with only the friendly half is not worth much.
    pub fn guidance(&self) -> String {
        let advice = match self {
            Self::NoDataDir => {
                "TRACE could not find a place to store the speech model. This usually means \
                 %LOCALAPPDATA% is unavailable."
            }
            Self::NotInstalled(_) => "The speech model is not installed yet.",
            Self::Download(detail) if looks_offline(detail) => {
                "No internet connection. TRACE downloads the speech model once — after that it \
                 works entirely offline."
            }
            Self::Download(_) => {
                "The download did not complete. It resumes from scratch, so trying again is safe."
            }
            Self::Extract(_) => {
                "The downloaded file could not be unpacked, which usually means it arrived \
                 damaged. Trying again will fetch a fresh copy."
            }
            Self::Incomplete { .. } => {
                "The model files are incomplete, probably from an interrupted download. \
                 Downloading again will replace them."
            }
            Self::Io(e) if is_disk_full(e) => {
                "Not enough space on disk. The speech model needs about 1.2 GB free while it \
                 installs, and about 700 MB afterwards."
            }
            Self::Io(_) => {
                "A file could not be written. Check that the disk is not full or \
                            read-only."
            }
        };

        format!("{advice} ({self})")
    }
}

/// Whether a download error is really "there is no network".
///
/// Matched on text because `ureq` folds transport failures into one error
/// type. Deliberately broad: over-reporting "no connection" when the machine
/// is online is a mild annoyance, while telling someone with no network to
/// "try again" wastes their time repeatedly.
fn looks_offline(detail: &str) -> bool {
    let d = detail.to_ascii_lowercase();
    [
        "dns",
        "resolve",
        "connect",
        "unreachable",
        "timed out",
        "timeout",
        "os error 11001",
    ]
    .iter()
    .any(|needle| d.contains(needle))
}

fn is_disk_full(e: &io::Error) -> bool {
    #[cfg(windows)]
    {
        if e.raw_os_error() == Some(ERROR_DISK_FULL) {
            return true;
        }
    }
    // StorageFull is stable but not returned by every platform for every
    // syscall, so it is a supplement to the raw code rather than a
    // replacement.
    matches!(e.kind(), io::ErrorKind::StorageFull)
}

/// A model TRACE knows how to fetch and load.
#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    /// Stable identifier, also the directory name under `models/`.
    pub id: &'static str,
    pub display_name: &'static str,
    /// Single gzipped tarball containing the files listed in `required_files`.
    pub archive_url: &'static str,
    pub approx_download_bytes: u64,
    /// Files that must exist for the model to be considered installed.
    ///
    /// Checked individually rather than trusting a marker file, so a download
    /// interrupted halfway is reported as incomplete instead of appearing
    /// installed and failing later at load time.
    pub required_files: &'static [&'static str],
}

/// Parakeet TDT 0.6B v3, int8 ONNX.
///
/// Chosen over Whisper as the default because it is both more accurate on the
/// Open ASR benchmarks (~6.3% vs ~7.4% average WER) and, decisively for a
/// meeting recorder, does not hallucinate text during silence — Whisper's
/// signature failure mode, and meetings are mostly silence.
///
/// The ONNX export is by istupakov; this tarball is the copy the
/// `transcribe-rs` README points at.
pub const PARAKEET_V3_INT8: ModelSpec = ModelSpec {
    id: "parakeet-tdt-0.6b-v3-int8",
    display_name: "Parakeet TDT 0.6B v3 (int8)",
    archive_url: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
    approx_download_bytes: 478_517_071,
    required_files: &[
        "encoder-model.int8.onnx",
        "decoder_joint-model.int8.onnx",
        "nemo128.onnx",
        "vocab.txt",
    ],
};

/// Root directory for all TRACE model data.
pub fn models_root() -> Result<PathBuf, ModelError> {
    let base = dirs::data_local_dir().ok_or(ModelError::NoDataDir)?;
    Ok(base.join("TRACE").join("models"))
}

/// Directory this specific model installs into.
pub fn model_dir(spec: &ModelSpec) -> Result<PathBuf, ModelError> {
    Ok(models_root()?.join(spec.id))
}

/// Whether every required file is present.
pub fn is_installed(spec: &ModelSpec) -> bool {
    match model_dir(spec) {
        Ok(dir) => missing_files(spec, &dir).is_empty(),
        Err(_) => false,
    }
}

/// Required files that are absent or empty.
///
/// Zero-length files count as missing: an interrupted download leaves those
/// behind, and they would otherwise pass a plain existence check and fail
/// confusingly deep inside ONNX Runtime.
pub fn missing_files(spec: &ModelSpec, dir: &Path) -> Vec<&'static str> {
    spec.required_files
        .iter()
        .copied()
        .filter(|name| match fs::metadata(dir.join(name)) {
            Ok(meta) => !meta.is_file() || meta.len() == 0,
            Err(_) => true,
        })
        .collect()
}

/// Path to an installed model, or an error explaining what is missing.
pub fn require_installed(spec: &ModelSpec) -> Result<PathBuf, ModelError> {
    let dir = model_dir(spec)?;
    let missing = missing_files(spec, &dir);
    if missing.is_empty() {
        return Ok(dir);
    }
    if missing.len() == spec.required_files.len() {
        return Err(ModelError::NotInstalled(spec.id));
    }
    Err(ModelError::Incomplete {
        name: spec.id,
        missing: missing.join(", "),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_offline_download_says_so_instead_of_suggesting_a_retry() {
        // The exact text ureq produces varies; what matters is that a
        // transport failure is not reported as "try again", which wastes the
        // time of someone who simply has no network.
        for detail in [
            "https://example/x.tar.gz: Dns Failed",
            "https://example/x.tar.gz: io: failed to connect",
            "https://example/x.tar.gz: network unreachable",
            "https://example/x.tar.gz: os error 11001",
        ] {
            let g = ModelError::Download(detail.into()).guidance();
            assert!(g.contains("No internet connection"), "{detail} -> {g}");
        }
    }

    #[test]
    fn a_server_side_failure_does_suggest_a_retry() {
        let g = ModelError::Download("expected 100 bytes, received 40".into()).guidance();
        assert!(g.contains("trying again is safe"), "{g}");
        assert!(!g.contains("No internet connection"), "{g}");
    }

    #[test]
    fn guidance_keeps_the_technical_detail() {
        // A bug report with only the friendly half is not worth much.
        let g = ModelError::Download("https://example/x: Dns Failed".into()).guidance();
        assert!(g.contains("Dns Failed"), "{g}");
    }

    #[test]
    fn a_full_disk_is_named_rather_than_called_an_io_error() {
        #[cfg(windows)]
        {
            let e = ModelError::Io(io::Error::from_raw_os_error(ERROR_DISK_FULL));
            assert!(
                e.guidance().contains("Not enough space"),
                "{}",
                e.guidance()
            );
        }

        let other = ModelError::Io(io::Error::from(io::ErrorKind::PermissionDenied));
        assert!(!other.guidance().contains("Not enough space"));
    }

    #[test]
    fn every_variant_has_guidance() {
        // A variant added without guidance would fall through to something
        // unhelpful; this fails loudly instead.
        let all = [
            ModelError::NoDataDir,
            ModelError::NotInstalled("m"),
            ModelError::Download("d".into()),
            ModelError::Extract("e".into()),
            ModelError::Incomplete {
                name: "m",
                missing: "f".into(),
            },
            ModelError::Io(io::Error::from(io::ErrorKind::Other)),
        ];
        for e in all {
            let g = e.guidance();
            assert!(g.len() > 20, "thin guidance for {e:?}: {g}");
        }
    }

    use super::*;

    #[test]
    fn models_root_is_outside_the_project() {
        let root = models_root().expect("data dir");
        assert!(root.ends_with("TRACE/models") || root.ends_with("TRACE\\models"));
        assert!(root.is_absolute());
    }

    #[test]
    fn a_missing_directory_reports_every_file_missing() {
        let dir = PathBuf::from("does-not-exist-anywhere");
        let missing = missing_files(&PARAKEET_V3_INT8, &dir);
        assert_eq!(missing.len(), PARAKEET_V3_INT8.required_files.len());
    }

    #[test]
    fn an_empty_file_counts_as_missing() {
        // An interrupted download leaves zero-length files behind. Treating
        // those as present would fail much later, inside ONNX Runtime.
        let dir = std::env::temp_dir().join(format!("trace-models-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for name in PARAKEET_V3_INT8.required_files {
            fs::write(dir.join(name), b"").unwrap();
        }

        let missing = missing_files(&PARAKEET_V3_INT8, &dir);
        assert_eq!(
            missing.len(),
            PARAKEET_V3_INT8.required_files.len(),
            "zero-length files must not count as installed"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_complete_directory_reports_nothing_missing() {
        let dir = std::env::temp_dir().join(format!("trace-models-ok-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for name in PARAKEET_V3_INT8.required_files {
            fs::write(dir.join(name), b"x").unwrap();
        }

        assert!(missing_files(&PARAKEET_V3_INT8, &dir).is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn partial_install_is_distinguished_from_no_install() {
        // These need different messages: "download it" versus "your download
        // was interrupted, here is what is missing".
        let dir = std::env::temp_dir().join(format!("trace-models-part-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("vocab.txt"), b"x").unwrap();

        let missing = missing_files(&PARAKEET_V3_INT8, &dir);
        assert!(!missing.is_empty());
        assert!(missing.len() < PARAKEET_V3_INT8.required_files.len());
        assert!(!missing.contains(&"vocab.txt"));

        fs::remove_dir_all(&dir).ok();
    }
}
