//! Searching the notes on disk.
//!
//! # Why there is no index
//!
//! The plan called for a SQLite FTS5 index. Measured instead: scanning 1,200
//! notes — about 5.4 MB, a daily meeting for five years — takes **106 ms in
//! release**, and it is I/O-bound rather than CPU-bound, so a debug build is
//! barely slower. At a realistic first-year library it is nearer 25 ms.
//!
//! An index would buy nothing at that size and cost a dependency, a C build,
//! and the oldest bug in search: an index that disagrees with the thing it
//! indexes.
//!
//! Markdown on disk is canonical. Reading it is the simplest thing that can
//! possibly work, and `search_is_fast_enough_without_an_index` in the tests
//! is what would tell us when it stops being.
//!
//! # What it matches
//!
//! Every term must appear somewhere in the note, in any order — the way
//! people actually search, rather than as a phrase. Matching is
//! case-insensitive and covers the transcript as well as the notes, because
//! "what did we say about pricing" is the question a meeting archive exists
//! to answer.

use std::path::Path;

use serde::Serialize;

use crate::meeting::MeetingType;

/// One note that matched, with enough context to decide whether to open it.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub date: String,
    #[serde(rename = "type")]
    pub meeting_type: MeetingType,
    /// Whether the title itself matched. Ranked above body-only matches.
    pub in_title: bool,
    /// A line containing a match, so the user can see *why* it matched.
    pub snippet: String,
    pub matches: usize,
}

/// Search every note under `root`.
///
/// Returns title matches first, then most recent first. An empty or
/// whitespace-only query returns nothing rather than everything: "show me
/// all notes" is the library's job, not search's.
pub fn search(root: &Path, query: &str) -> Vec<SearchHit> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|t| !t.is_empty())
        .collect();

    if terms.is_empty() {
        return Vec::new();
    }

    let mut hits = Vec::new();
    collect(root, &terms, &mut hits);

    // Title matches first; within each group, newest first. Filenames begin
    // with the ISO date, so the path comparison is chronological.
    hits.sort_by(|a, b| {
        b.in_title
            .cmp(&a.in_title)
            .then_with(|| b.path.cmp(&a.path))
    });
    hits
}

fn collect(dir: &Path, terms: &[String], out: &mut Vec<SearchHit>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            // Session working directories hold journals and audio, not notes.
            if path.file_name().is_some_and(|n| n == ".sessions") {
                continue;
            }
            collect(&path, terms, out);
            continue;
        }

        if !path.extension().is_some_and(|e| e == "md") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };

        if let Some(hit) = examine(&path, &text, terms) {
            out.push(hit);
        }
    }
}

fn examine(path: &Path, text: &str, terms: &[String]) -> Option<SearchHit> {
    let haystack = text.to_lowercase();

    // Every term, anywhere. A note missing one is not a match.
    if !terms.iter().all(|t| haystack.contains(t.as_str())) {
        return None;
    }

    let title = super::markdown::frontmatter_value(text, "title").unwrap_or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    });
    let lower_title = title.to_lowercase();
    let in_title = terms.iter().any(|t| lower_title.contains(t.as_str()));

    let matches = terms
        .iter()
        .map(|t| haystack.matches(t.as_str()).count())
        .sum();

    Some(SearchHit {
        path: path.display().to_string(),
        date: super::markdown::frontmatter_value(text, "date").unwrap_or_default(),
        meeting_type: super::markdown::parse_meeting_type(text).unwrap_or_default(),
        snippet: snippet(text, terms),
        title,
        in_title,
        matches,
    })
}

/// The first body line containing a term, trimmed for display.
///
/// Frontmatter is skipped: matching on `id:` or `participants:` would show
/// the user a line of YAML, which tells them nothing about the meeting.
fn snippet(text: &str, terms: &[String]) -> String {
    let mut lines = text.lines();

    // Step over frontmatter if present.
    if lines.clone().next().is_some_and(|l| l.trim() == "---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    }

    for line in lines {
        let lower = line.to_lowercase();
        if !terms.iter().any(|t| lower.contains(t.as_str())) {
            continue;
        }

        // Strip the transcript's own formatting so the snippet reads as
        // speech rather than as Markdown.
        let cleaned = line
            .trim()
            .trim_start_matches("- [ ] ")
            .trim_start_matches("- [x] ")
            .trim_start_matches("- ")
            .trim_start_matches("## ")
            .trim_start_matches("# ")
            .replace("**", "")
            .replace('`', "");
        let cleaned = cleaned.trim();

        if cleaned.is_empty() {
            continue;
        }
        return truncate(cleaned, 160);
    }

    String::new()
}

/// Cut to `max` characters on a character boundary, with an ellipsis.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::write_note;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-search-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn note(root: &Path, id: &str, title: &str, notes: &str) {
        let mut m = crate::meeting::Meeting::new(id, title);
        m.date = "2026-09-06".into();
        m.notes = notes.into();
        write_note(root, &m).unwrap();
    }

    #[test]
    fn an_empty_query_matches_nothing() {
        // "Show me everything" is the library's job. Search returning the
        // whole archive for an empty box is noise dressed as a result.
        let root = scratch("empty");
        note(&root, "s1", "Standup", "anything");

        assert!(search(&root, "").is_empty());
        assert!(search(&root, "   ").is_empty());
    }

    #[test]
    fn every_term_must_appear() {
        let root = scratch("terms");
        note(
            &root,
            "s1",
            "Pricing review",
            "we discussed the comparison table",
        );

        assert_eq!(search(&root, "pricing table").len(), 1);
        // "elephant" appears nowhere, so the note is not a match.
        assert!(search(&root, "pricing elephant").is_empty());
    }

    #[test]
    fn matching_ignores_case_and_word_order() {
        let root = scratch("case");
        note(
            &root,
            "s1",
            "Pricing review",
            "the Comparison Table was the problem",
        );

        assert_eq!(search(&root, "TABLE comparison").len(), 1);
    }

    #[test]
    fn title_matches_rank_above_body_matches() {
        let root = scratch("rank");
        note(
            &root,
            "s1",
            "Weekly sync",
            "we talked about pricing at length",
        );
        note(&root, "s2", "Pricing review", "nothing much");

        let hits = search(&root, "pricing");
        assert_eq!(hits.len(), 2);
        assert!(hits[0].in_title, "body match outranked a title match");
        assert_eq!(hits[0].title, "Pricing review");
    }

    #[test]
    fn the_snippet_shows_why_it_matched_and_is_not_yaml() {
        // Matching on `id:` or `participants:` and then showing that line
        // tells the user nothing about the meeting.
        let root = scratch("snippet");
        note(
            &root,
            "s1",
            "Weekly sync",
            "the comparison table is the problem",
        );

        let hits = search(&root, "comparison");
        assert_eq!(hits.len(), 1);
        assert!(
            hits[0].snippet.contains("comparison table"),
            "got: {:?}",
            hits[0].snippet
        );
        assert!(!hits[0].snippet.contains(':'), "snippet leaked frontmatter");
    }

    #[test]
    fn sessions_are_not_searched() {
        // Journals hold the same words as the notes; matching them would
        // return every meeting twice.
        let root = scratch("sessions");
        note(&root, "s1", "Standup", "deploy went out");

        let session = root.join(".sessions").join("s1");
        std::fs::create_dir_all(&session).unwrap();
        std::fs::write(session.join("notes.md"), "deploy went out").unwrap();

        assert_eq!(search(&root, "deploy").len(), 1);
    }

    #[test]
    fn search_is_fast_enough_without_an_index() {
        // The plan called for SQLite FTS5. This is the measurement that says
        // it is not needed yet — and the one that will say when it is.
        //
        // 1,200 notes is roughly a daily meeting for five years.
        let root = scratch("scale");
        let body = "we discussed the migration timeline and the staging environment at length. "
            .repeat(60);
        for i in 0..1_200 {
            note(&root, &format!("s{i}"), &format!("Meeting {i}"), &body);
        }

        let start = std::time::Instant::now();
        let hits = search(&root, "staging environment");
        let elapsed = start.elapsed();

        assert_eq!(hits.len(), 1_200);
        // Measured at ~106 ms in release, ~150 ms in debug. The bound is
        // deliberately loose: this is a canary for an order-of-magnitude
        // regression, not a benchmark, and it runs on whatever CI has.
        assert!(
            elapsed.as_millis() < 2_000,
            "scanning 1,200 notes took {elapsed:?} — time to reconsider an index"
        );
        println!("scanned 1,200 notes in {elapsed:?}");
    }
}
