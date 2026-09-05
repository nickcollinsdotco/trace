//! Facts about the machine, for the first-run report.
//!
//! TRACE's first run has something genuinely unavoidable to do — fetch a
//! ~456 MB speech model — and a progress bar with nothing around it wastes
//! the one moment the user is actually paying attention.
//!
//! So the setup screen is a *machine report*: what this computer is, what is
//! about to be installed, and where it is going. That is not decoration. It
//! is the honest answer to the two questions someone has on first run — "can
//! my machine do this?" and "what are you putting on my disk?" — and it
//! happens to fit the visual direction exactly (docs/12-VISUAL-TRIAGE.md).
//!
//! Everything here is measured. Nothing is invented to fill a row.

use serde::Serialize;
use sysinfo::{Disks, System};

use crate::models::{self, ModelSpec};

#[derive(Debug, Clone, Serialize)]
pub struct SystemReport {
    pub host: String,
    pub os: String,
    pub kernel: String,

    pub cpu: String,
    pub cores: Option<usize>,
    pub threads: usize,
    pub memory_bytes: u64,

    /// What inference actually runs on. See `accelerator()`.
    pub accelerator: String,

    pub model_name: &'static str,
    pub model_bytes: u64,
    pub model_dir: String,
    /// Free space on the volume the model installs to, when it can be read.
    pub disk_free_bytes: Option<u64>,
    pub installed: bool,
}

/// What inference actually runs on.
///
/// Deliberately not "DirectML". `transcribe-rs` is built with the `onnx`
/// feature only — no `ort-directml` — so ONNX Runtime uses its CPU provider,
/// whatever `DirectML.dll` sitting next to the binary might suggest. Claiming
/// GPU acceleration on a screen whose job is to tell the truth about this
/// machine would be exactly the wrong place to be loose.
fn accelerator() -> String {
    "CPU · ONNX Runtime (int8)".to_string()
}

pub fn report(spec: &ModelSpec) -> SystemReport {
    let mut sys = System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpu = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "Unknown processor".to_string());

    let model_dir = models::model_dir(spec)
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    SystemReport {
        host: System::host_name().unwrap_or_else(|| "unknown".into()),
        os: System::long_os_version().unwrap_or_else(|| "Unknown OS".into()),
        kernel: System::kernel_version().unwrap_or_default(),

        cpu,
        cores: System::physical_core_count(),
        threads: sys.cpus().len(),
        memory_bytes: sys.total_memory(),

        accelerator: accelerator(),

        model_name: spec.display_name,
        model_bytes: spec.approx_download_bytes,
        disk_free_bytes: free_space_for(&model_dir),
        model_dir,
        installed: models::is_installed(spec),
    }
}

/// Free space on the volume a path lives on.
///
/// Matched by longest mount point rather than first hit, so a path under a
/// mounted volume is not attributed to `C:\` merely because that came first
/// in the list.
fn free_space_for(path: &str) -> Option<u64> {
    if path.is_empty() {
        return None;
    }

    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| {
            let mount = d.mount_point().to_string_lossy().to_lowercase();
            path.to_lowercase().starts_with(&mount)
        })
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PARAKEET_V3_INT8;

    #[test]
    fn the_report_describes_a_real_machine() {
        let r = report(&PARAKEET_V3_INT8);

        // Every row on the screen must come from a measurement. A blank one
        // is worse than an absent one, because the layout still reserves it.
        assert!(!r.host.is_empty());
        assert!(!r.os.is_empty());
        assert!(!r.cpu.is_empty());
        assert!(r.threads > 0, "no logical CPUs reported");
        assert!(r.memory_bytes > 0, "no memory reported");
        assert!(!r.model_dir.is_empty());
        assert_eq!(r.model_bytes, PARAKEET_V3_INT8.approx_download_bytes);
    }

    #[test]
    fn the_accelerator_is_not_overclaimed() {
        // The build has no ort-directml feature, so this must not say GPU.
        let r = report(&PARAKEET_V3_INT8);
        let lower = r.accelerator.to_lowercase();
        assert!(
            !lower.contains("directml"),
            "claimed DirectML: {}",
            r.accelerator
        );
        assert!(!lower.contains("gpu"), "claimed GPU: {}", r.accelerator);
    }

    #[test]
    fn an_empty_path_has_no_volume() {
        assert_eq!(free_space_for(""), None);
    }

    #[test]
    fn free_space_is_read_for_a_real_path() {
        // Cheap smoke test: the models directory is on a real volume, so a
        // None here means the mount-point matching is broken.
        let dir = models::model_dir(&PARAKEET_V3_INT8).unwrap();
        assert!(
            free_space_for(&dir.display().to_string()).is_some(),
            "no volume matched {}",
            dir.display()
        );
    }
}
