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
