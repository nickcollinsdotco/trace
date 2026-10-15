//! Whether the summary model has room on this machine right now.
//!
//! A summary model is the heaviest thing TRACE does: ~11 GiB for the 14B at
//! `NUM_CTX`, loaded in one go. On a machine already busy with a video call,
//! design tools and browsers, that load once froze the whole computer — the
//! model spilled out of video memory into system memory that was already
//! spoken for, and Windows paged itself to a standstill. Ollama does not
//! refuse a load that will not fit; it degrades until the machine does.
//!
//! So TRACE asks first. Free system memory comes from `sysinfo`; free video
//! memory from the same counters Task Manager reads (`GPU Adapter Memory`),
//! matched to the adapter with the most dedicated memory, which is the one
//! Ollama runs on. What the model needs is what Ollama last reported it
//! occupying, or an estimate from its weights and context — see
//! `synthesis::ollama::footprint`.
//!
//! The decision itself is `assess`, a pure function, so the policy is tested
//! on numbers rather than on whatever this machine happens to have free.

use std::sync::OnceLock;

use crate::synthesis::ollama::{Footprint, LoadedModel};

const GIB: u64 = 1 << 30;

/// The machine's memory, as measured a moment ago.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Machine {
    pub ram_total: u64,
    /// Free plus reclaimable standby: what a new allocation can have
    /// without anything being paged out.
    pub ram_available: u64,
    /// `None` when there is no discrete GPU, or its usage cannot be read.
    pub gpu: Option<Gpu>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Gpu {
    pub name: String,
    pub total: u64,
    /// Dedicated memory in use by every process, not just TRACE's.
    pub used: u64,
}

impl Gpu {
    pub fn free(&self) -> u64 {
        self.total.saturating_sub(self.used)
    }
}

/// What loading the model would do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum Verdict {
    /// Already loaded and not adding to any shortage: nothing to load.
    Resident,
    /// Fits in free video memory with room to spare.
    OnGpu,
    /// Fits only with `ram_bytes` of it in system memory. Slower, but the
    /// machine keeps its headroom.
    Spills { ram_bytes: u64 },
    /// Loading would eat into the memory everything else needs.
    NoRoom,
}

impl Verdict {
    pub fn fits(self) -> bool {
        !matches!(self, Verdict::NoRoom)
    }
}

/// System memory left for everything else after a load.
///
/// A fraction of the total, because what the rest of a machine needs grows
/// with what it is used for, with a floor for small machines where 10% is
/// not enough for a browser and a call.
pub fn ram_headroom(total: u64) -> u64 {
    (total / 10).max(2 * GIB)
}

/// Video memory left free after a load, for the call's video, the
/// compositor, and NVIDIA Broadcast and the like, which all live there too.
pub fn vram_headroom(total: u64) -> u64 {
    (total / 16).max(GIB / 2)
}

/// Below this, a model partly in system memory is part of the problem.
pub fn ram_critical(total: u64) -> u64 {
    (total / 20).max(GIB)
}

/// Decide whether `need` bytes can be loaded now.
///
/// `resident` is the model as Ollama has it in memory already, if it does:
/// re-checking a loaded model is about whether keeping it is safe, not
/// whether loading it is.
pub fn assess(machine: &Machine, need: u64, resident: Option<&LoadedModel>) -> Verdict {
    if let Some(model) = resident {
        let in_ram = model.size_bytes.saturating_sub(model.vram_bytes);
        // Wholly on the GPU, it is not what is short of system memory, and
        // unloading it would only cost a reload. Partly in system memory
        // while that runs out, it is the pressure — and carrying on is how
        // the machine ends up paging.
        return if in_ram > 0 && machine.ram_available < ram_critical(machine.ram_total) {
            Verdict::NoRoom
        } else {
            Verdict::Resident
        };
    }

    let ram_room = machine
        .ram_available
        .saturating_sub(ram_headroom(machine.ram_total));
    let gpu_room = machine
        .gpu
        .as_ref()
        .map(|g| g.free().saturating_sub(vram_headroom(g.total)))
        .unwrap_or(0);

    // Even a load that lands wholly on the GPU passes through system memory
    // on its way, and a machine already inside its headroom is one where
    // something else is about to need it.
    if ram_room == 0 {
        return Verdict::NoRoom;
    }
    if need <= gpu_room {
        return Verdict::OnGpu;
    }
    let spill = need - gpu_room;
    if spill <= ram_room {
        Verdict::Spills { ram_bytes: spill }
    } else {
        Verdict::NoRoom
    }
}

/// One look at the machine and the model, and what it means.
#[derive(Debug, Clone)]
pub struct Check {
    pub model: String,
    pub need: Footprint,
    pub machine: Machine,
    pub resident: Option<LoadedModel>,
    pub verdict: Verdict,
}

impl Check {
    pub fn fits(&self) -> bool {
        self.verdict.fits()
    }

    /// One line for the diagnostics log: what was seen, and what was decided.
    /// Sizes only — the next "it froze" report should answer itself.
    pub fn describe(&self, when: &str) -> String {
        let gpu = match &self.machine.gpu {
            Some(g) => format!("GPU {} {} of {} free", g.name, gib(g.free()), gib(g.total)),
            None => "GPU memory unreadable".to_string(),
        };
        let resident = match &self.resident {
            Some(m) => format!(
                ", already loaded ({} on the GPU of {})",
                gib(m.vram_bytes),
                gib(m.size_bytes)
            ),
            None => String::new(),
        };
        let decision = match self.verdict {
            Verdict::Resident => "keeping it".to_string(),
            Verdict::OnGpu => "loading it on the GPU".to_string(),
            Verdict::Spills { ram_bytes } => {
                format!("loading it with {} in system memory", gib(ram_bytes))
            }
            Verdict::NoRoom => "not loading it: not enough memory".to_string(),
        };
        format!(
            "memory check {when}: {} needs {} ({}){resident}; RAM {} of {} available; {gpu}; {decision}",
            self.model,
            gib(self.need.bytes),
            if self.need.measured {
                "measured"
            } else {
                "estimated"
            },
            gib(self.machine.ram_available),
            gib(self.machine.ram_total),
        )
    }
}

/// Look at the machine and decide about `model`. Blocking: asks Ollama what
/// it has loaded, and what the model weighs if that is not yet known.
pub fn check(model: &str) -> Check {
    use crate::synthesis::ollama::{footprint, OllamaProvider};

    let resident = OllamaProvider::loaded()
        .into_iter()
        .find(|m| m.name == model);
    let need = footprint(model);
    let machine = machine();
    let verdict = assess(&machine, need.bytes, resident.as_ref());
    Check {
        model: model.to_string(),
        need,
        machine,
        resident,
        verdict,
    }
}

/// Physical memory, read once: it does not change while TRACE runs, and
/// settings ask for it on every read.
pub fn total_ram() -> u64 {
    static TOTAL: OnceLock<u64> = OnceLock::new();
    *TOTAL.get_or_init(|| {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        sys.total_memory()
    })
}

pub fn machine() -> Machine {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    Machine {
        ram_total: sys.total_memory(),
        ram_available: sys.available_memory(),
        gpu: gpu(),
    }
}

/// "11.3 GiB", for log lines.
pub fn gib(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / GIB as f64)
}

/// The discrete GPU and how much of its memory is in use.
///
/// DXGI names the adapters and their dedicated memory; the performance
/// counters say how much of it every process together is using, which DXGI's
/// own budget does not — it describes this process's share, and the memory
/// that matters here is what the call, the browser and Broadcast hold.
#[cfg(windows)]
fn gpu() -> Option<Gpu> {
    let (name, total, luid) = largest_adapter()?;
    let used = dedicated_usage(&luid)?;
    Some(Gpu { name, total, used })
}

#[cfg(not(windows))]
fn gpu() -> Option<Gpu> {
    None
}

/// Integrated GPUs report a small carve-out as dedicated memory. Below this
/// it is not a card Ollama would load a summary model onto.
#[cfg(windows)]
const DISCRETE_MIN: u64 = GIB;

#[cfg(windows)]
fn largest_adapter() -> Option<(String, u64, String)> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    // SAFETY: plain COM calls on interfaces this function owns; the factory
    // and adapters are released when they go out of scope.
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
    let mut best: Option<(String, u64, String)> = None;
    for i in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(i) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        let total = desc.DedicatedVideoMemory as u64;
        if total < DISCRETE_MIN || best.as_ref().is_some_and(|b| b.1 >= total) {
            continue;
        }
        let len = desc
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..len]);
        // How the performance counters name an adapter's instances.
        let luid = format!(
            "luid_0x{:08x}_0x{:08x}",
            desc.AdapterLuid.HighPart as u32, desc.AdapterLuid.LowPart
        );
        best = Some((name, total, luid));
    }
    best
}

/// Dedicated memory in use on one adapter, across every process.
#[cfg(windows)]
fn dedicated_usage(luid: &str) -> Option<u64> {
    let items = counter_items(windows::core::w!(
        "\\GPU Adapter Memory(*)\\Dedicated Usage"
    ))?;
    let mine: Vec<u64> = items
        .into_iter()
        .filter(|(name, _)| name.starts_with(luid))
        .map(|(_, bytes)| bytes)
        .collect();
    (!mine.is_empty()).then(|| mine.iter().sum())
}

/// Every instance of one performance counter, by lower-cased instance name.
#[cfg(windows)]
fn counter_items(path: windows::core::PCWSTR) -> Option<Vec<(String, u64)>> {
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_LARGE, PDH_HCOUNTER, PDH_HQUERY,
        PDH_MORE_DATA,
    };

    const OK: u32 = 0;
    let mut query = PDH_HQUERY::default();
    // SAFETY: the query is closed on every path below; the item buffer is
    // sized by PDH's own first call and outlives the reads from it.
    unsafe {
        if PdhOpenQueryW(None, 0, &mut query) != OK {
            return None;
        }
        let close = scopeguard::guard(query, |q| {
            PdhCloseQuery(q);
        });

        let mut counter = PDH_HCOUNTER::default();
        if PdhAddEnglishCounterW(*close, path, 0, &mut counter) != OK {
            return None;
        }
        // A raw count, not a rate, so one sample is enough.
        if PdhCollectQueryData(*close) != OK {
            return None;
        }

        let mut bytes = 0u32;
        let mut count = 0u32;
        if PdhGetFormattedCounterArrayW(counter, PDH_FMT_LARGE, &mut bytes, &mut count, None)
            != PDH_MORE_DATA
        {
            return None;
        }
        let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
        let mut buffer: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> =
            vec![Default::default(); (bytes as usize).div_ceil(item)];
        if PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_LARGE,
            &mut bytes,
            &mut count,
            Some(buffer.as_mut_ptr()),
        ) != OK
        {
            return None;
        }

        Some(
            buffer[..count as usize]
                .iter()
                .map(|item| {
                    (
                        item.szName.to_string().unwrap_or_default().to_lowercase(),
                        u64::try_from(item.FmtValue.Anonymous.largeValue).unwrap_or(0),
                    )
                })
                .collect(),
        )
    }
}

/// An app holding a share of the memory the summary model would need.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Hog {
    /// The program's name as Windows has it, without `.exe`.
    pub name: String,
    /// Graphics memory, across all its processes. Zero where unreadable.
    pub gpu_bytes: u64,
    /// System memory it has resident now, across all its processes.
    pub ram_bytes: u64,
}

/// Below this, an app is not worth naming: closing it would not make room.
const HOG_MIN: u64 = GIB / 2;

/// Windows itself, which nobody can close: the compositor alone holds a
/// gigabyte of the card on a 4K screen, and naming it would be no help.
const NOT_CLOSABLE: &[&str] = &[
    "dwm",
    "csrss",
    "System",
    "Registry",
    "Memory Compression",
    "explorer",
    "svchost",
    "MsMpEng",
];

/// The apps holding the most memory now, largest first, at most `count`.
///
/// "Close some apps" asks the user to guess, and the guess is usually wrong:
/// the app that filled the machine on 2026-10-15 was a design tool with old
/// files open — 7 GB of the graphics card and most of the RAM — not the
/// call. Naming it turns a vague chore into one obvious thing to close.
///
/// Resident memory rather than committed: an app with most of its memory
/// paged out is not what is short, and would be named for nothing. TRACE
/// itself and Ollama are left out — they are what the room is for — and so
/// is Windows.
pub fn hogs(count: usize) -> Vec<Hog> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    let gpu = gpu_by_process();
    let own = std::process::id();

    let mut by_name: Vec<Hog> = Vec::new();
    for (pid, process) in sys.processes() {
        if pid.as_u32() == own {
            continue;
        }
        let name = process.name().to_string_lossy();
        let name = name.strip_suffix(".exe").unwrap_or(&name).to_string();
        if name.to_lowercase().starts_with("ollama")
            || NOT_CLOSABLE.iter().any(|n| n.eq_ignore_ascii_case(&name))
        {
            continue;
        }
        let gpu_bytes = gpu
            .iter()
            .find(|(p, _)| *p == pid.as_u32())
            .map_or(0, |(_, b)| *b);
        match by_name
            .iter_mut()
            .find(|h| h.name.eq_ignore_ascii_case(&name))
        {
            Some(hog) => {
                hog.gpu_bytes += gpu_bytes;
                hog.ram_bytes += process.memory();
            }
            None => by_name.push(Hog {
                name,
                gpu_bytes,
                ram_bytes: process.memory(),
            }),
        }
    }
    rank_hogs(by_name, count)
}

/// Biggest first by what they hold of either kind; the small ones dropped.
fn rank_hogs(mut hogs: Vec<Hog>, count: usize) -> Vec<Hog> {
    hogs.retain(|h| h.gpu_bytes + h.ram_bytes >= HOG_MIN);
    hogs.sort_by_key(|h| std::cmp::Reverse(h.gpu_bytes + h.ram_bytes));
    hogs.truncate(count);
    hogs
}

/// Dedicated graphics memory per process id, on the card Ollama would use.
#[cfg(windows)]
fn gpu_by_process() -> Vec<(u32, u64)> {
    let Some((_, _, luid)) = largest_adapter() else {
        return Vec::new();
    };
    let Some(items) = counter_items(windows::core::w!(
        "\\GPU Process Memory(*)\\Dedicated Usage"
    )) else {
        return Vec::new();
    };
    let mut out: Vec<(u32, u64)> = Vec::new();
    for (name, bytes) in items {
        // `pid_1234_luid_0x…_0x…_phys_0`
        let Some(rest) = name.strip_prefix("pid_") else {
            continue;
        };
        let Some((pid, adapter)) = rest.split_once('_') else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        if !adapter.starts_with(&luid) {
            continue;
        }
        match out.iter_mut().find(|(p, _)| *p == pid) {
            Some((_, b)) => *b += bytes,
            None => out.push((pid, bytes)),
        }
    }
    out
}

#[cfg(not(windows))]
fn gpu_by_process() -> Vec<(u32, u64)> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine(ram_total: u64, ram_available: u64, gpu: Option<(u64, u64)>) -> Machine {
        Machine {
            ram_total: ram_total * GIB,
            ram_available: ram_available * GIB,
            gpu: gpu.map(|(total, used)| Gpu {
                name: "test".into(),
                total: total * GIB,
                used: used * GIB,
            }),
        }
    }

    fn loaded(size: u64, vram: u64) -> LoadedModel {
        LoadedModel {
            name: "m".into(),
            size_bytes: size * GIB,
            vram_bytes: vram * GIB,
            context_length: Some(8192),
            expires_at: None,
        }
    }

    #[test]
    fn a_model_that_fits_the_free_card_loads_there() {
        // 16 GiB card with 4.5 GiB in use: room for the 14B's ~11 GiB.
        let m = machine(31, 12, Some((16, 4)));
        assert_eq!(assess(&m, 11 * GIB, None), Verdict::OnGpu);
    }

    #[test]
    fn the_freeze_that_prompted_this_is_refused() {
        // The card mostly taken by the call, Figma and Broadcast, and system
        // memory already low: the model would land in RAM nobody had.
        let m = machine(31, 5, Some((16, 10)));
        assert_eq!(assess(&m, 11 * GIB, None), Verdict::NoRoom);
    }

    #[test]
    fn spilling_is_allowed_while_system_memory_has_room_for_it() {
        let m = machine(64, 40, Some((8, 1)));
        match assess(&m, 11 * GIB, None) {
            Verdict::Spills { ram_bytes } => {
                // 8 GiB card, 1 used, 0.5 kept back: 6.5 on the GPU.
                assert_eq!(ram_bytes, 11 * GIB - (7 * GIB - GIB / 2));
            }
            other => panic!("expected a spill, got {other:?}"),
        }
    }

    #[test]
    fn without_a_readable_gpu_the_whole_model_must_fit_in_system_memory() {
        assert_eq!(
            assess(&machine(32, 12, None), 11 * GIB, None),
            Verdict::NoRoom
        );
        assert!(matches!(
            assess(&machine(32, 20, None), 11 * GIB, None),
            Verdict::Spills { .. }
        ));
    }

    #[test]
    fn a_machine_already_inside_its_headroom_loads_nothing_even_onto_the_gpu() {
        // The card is empty, but 1.5 GiB of system memory is left.
        let m = machine(16, 1, Some((24, 1)));
        assert_eq!(assess(&m, 6 * GIB, None), Verdict::NoRoom);
    }

    #[test]
    fn a_resident_model_on_the_gpu_is_kept_however_low_ram_runs() {
        let m = machine(32, 1, Some((16, 15)));
        assert_eq!(
            assess(&m, 11 * GIB, Some(&loaded(11, 11))),
            Verdict::Resident
        );
    }

    #[test]
    fn a_resident_model_in_system_memory_is_dropped_when_it_runs_out() {
        let spilled = loaded(11, 8);
        assert_eq!(
            assess(&machine(32, 1, Some((16, 15))), 11 * GIB, Some(&spilled)),
            Verdict::NoRoom
        );
        assert_eq!(
            assess(&machine(32, 6, Some((16, 15))), 11 * GIB, Some(&spilled)),
            Verdict::Resident
        );
    }

    #[test]
    fn headroom_grows_with_the_machine_but_never_below_its_floor() {
        assert_eq!(ram_headroom(8 * GIB), 2 * GIB);
        assert_eq!(ram_headroom(64 * GIB), 64 * GIB / 10);
        assert_eq!(vram_headroom(6 * GIB), GIB / 2);
        assert_eq!(vram_headroom(16 * GIB), GIB);
    }

    #[test]
    fn the_log_line_says_what_was_seen_and_decided() {
        let check = Check {
            model: "qwen3:14b".into(),
            need: Footprint {
                bytes: 11 * GIB,
                measured: false,
            },
            machine: machine(31, 5, Some((16, 10))),
            resident: None,
            verdict: Verdict::NoRoom,
        };
        let line = check.describe("before notes");
        assert!(
            line.contains("qwen3:14b needs 11.0 GiB (estimated)"),
            "{line}"
        );
        assert!(line.contains("RAM 5.0 GiB of 31.0 GiB available"), "{line}");
        assert!(line.contains("6.0 GiB of 16.0 GiB free"), "{line}");
        assert!(
            line.ends_with("not loading it: not enough memory"),
            "{line}"
        );
    }

    #[test]
    fn this_machine_can_be_measured() {
        // Smoke test against the real machine: the numbers exist and agree.
        let m = super::machine();
        assert!(m.ram_total > 0 && m.ram_available <= m.ram_total);
        if let Some(g) = &m.gpu {
            assert!(g.total >= GIB, "{g:?}");
        }
    }

    fn hog(name: &str, gpu: u64, ram: u64) -> Hog {
        Hog {
            name: name.into(),
            gpu_bytes: gpu,
            ram_bytes: ram,
        }
    }

    #[test]
    fn hogs_are_ranked_by_all_they_hold_and_small_ones_left_out() {
        let ranked = rank_hogs(
            vec![
                hog("chrome", 4 * GIB, 3 * GIB),
                hog("Figma", 7 * GIB, 3 * GIB),
                hog("notepad", 0, GIB / 8),
                hog("Teams", 0, GIB),
            ],
            3,
        );
        let names: Vec<&str> = ranked.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, ["Figma", "chrome", "Teams"]);
        assert_eq!(rank_hogs(vec![hog("notepad", 0, GIB / 8)], 3), vec![]);
    }

    #[test]
    fn the_apps_on_this_machine_can_be_named() {
        // Smoke test: on any machine running these tests, something holds
        // half a gigabyte, and nothing is named twice.
        let hogs = super::hogs(5);
        assert!(!hogs.is_empty());
        for (i, h) in hogs.iter().enumerate() {
            assert!(!hogs[..i]
                .iter()
                .any(|o| o.name.eq_ignore_ascii_case(&h.name)));
        }
    }
}
