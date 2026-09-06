//! Reading and writing a note's tags.
//!
//! Tags live in frontmatter as a YAML block list, which is what `serialize`
//! already writes:
//!
//! ```text
//! tags:
//!   - pricing
//!   - client
//! ```
//!
//! # Why this edits the file rather than round-tripping the meeting
//!
//! A note's body is never re-parsed — only frontmatter and action-item
//! checkboxes are read back (`docs/06-DATA-MODEL.md`). Rebuilding a `Meeting`
//! to change one field would mean parsing prose, which is exactly the fragile
//! thing that decision exists to avoid. So this rewrites the tag lines and
//! leaves every other byte of the file alone.

use std::path::Path;

use super::{paths, StoreError};

/// Normalise a tag: lower-case, trimmed, inner whitespace collapsed to `-`.
///
/// Tags are for grouping, and `Pricing`, `pricing ` and `pricing` grouping
/// separately would defeat that. Case is not information here.
pub fn normalise(tag: &str) -> String {
    tag.trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

/// Read a note's tags from its frontmatter.
pub fn read(markdown: &str) -> Vec<String> {
    let mut lines = markdown.lines();
    // `is_some_and` rather than `is_none_or`: the latter is stable only from
    // Rust 1.82 and this crate's MSRV is 1.77.2.
    if !lines.next().is_some_and(|l| l.trim() == "---") {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut in_tags = false;

    for line in lines {
        if line.trim() == "---" {
            break;
        }

        if line.starts_with("tags:") {
            in_tags = true;
            continue;
        }

        if in_tags {
            // Items are indented; anything at column zero ends the list.
            let Some(item) = line.strip_prefix("  - ") else {
                if !line.starts_with(' ') {
                    in_tags = false;
                }
                continue;
            };
            let value = item.trim();
            let unquoted = value
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'))
                .map(|v| v.replace("\\\"", "\"").replace("\\\\", "\\"))
                .unwrap_or_else(|| value.to_string());
            if !unquoted.is_empty() {
                out.push(unquoted);
            }
        }
    }

    out
}

/// Replace a note's tags, leaving the rest of the file untouched.
///
/// Tags are normalised and de-duplicated, then sorted so the file does not
/// churn in version control when the same set is written in a different
/// order. An empty set removes the key entirely rather than leaving `tags:`
/// with nothing under it, which is not valid YAML.
pub fn write(note_path: &Path, tags: &[String]) -> Result<Vec<String>, StoreError> {
    let text = std::fs::read_to_string(note_path)?;

    let mut clean: Vec<String> = tags
        .iter()
        .map(|t| normalise(t))
        .filter(|t| !t.is_empty())
        .collect();
    clean.sort();
    clean.dedup();

    let updated = replace_tags(&text, &clean);
    paths::write_atomic(note_path, &updated)?;
    Ok(clean)
}

/// Rewrite the `tags:` block in a frontmatter string.
fn replace_tags(markdown: &str, tags: &[String]) -> String {
    let mut out = String::with_capacity(markdown.len() + tags.len() * 16);
    let mut lines = markdown.lines();

    let Some(first) = lines.next() else {
        return markdown.to_string();
    };
    if first.trim() != "---" {
        // No frontmatter to edit. Refusing beats inventing one on a file that
        // may not be a note at all.
        return markdown.to_string();
    }

    out.push_str("---\n");
    let mut in_tags = false;
    let mut written = false;

    for line in lines {
        if line.trim() == "---" {
            // Frontmatter had no tags key; add one before closing.
            if !written && !tags.is_empty() {
                push_tags(&mut out, tags);
            }
            out.push_str("---\n");
            // Everything after the closing marker is the body, verbatim.
            let rest = markdown
                .split_once("\n---\n")
                .map(|(_, body)| body)
                .unwrap_or("");
            out.push_str(rest);
            return out;
        }

        if line.starts_with("tags:") {
            in_tags = true;
            if !tags.is_empty() {
                push_tags(&mut out, tags);
            }
            written = true;
            continue;
        }

        if in_tags {
            if line.starts_with("  - ") || line.starts_with(' ') {
                continue; // old item, dropped
            }
            in_tags = false;
        }

        out.push_str(line);
        out.push('\n');
    }

    out
}

fn push_tags(out: &mut String, tags: &[String]) {
    out.push_str("tags:\n");
    for tag in tags {
        out.push_str("  - ");
        out.push_str(tag);
        out.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str =
        "---\nid: sess-1\ntitle: Pricing\ndate: 2026-09-06\n---\n\n# Pricing\n\nbody stays\n";

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-tags-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("note.md")
    }

    #[test]
    fn tags_normalise_so_grouping_works() {
        assert_eq!(normalise("  Pricing  "), "pricing");
        assert_eq!(normalise("Design Review"), "design-review");
        assert_eq!(normalise("CLIENT"), "client");
    }

    #[test]
    fn tags_are_added_to_a_note_that_had_none() {
        let path = scratch("add");
        std::fs::write(&path, NOTE).unwrap();

        let written = write(&path, &["Pricing".into(), "client".into()]).unwrap();
        assert_eq!(written, vec!["client", "pricing"]);

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read(&text), vec!["client", "pricing"]);
        // Every other byte survives.
        assert!(text.contains("id: sess-1"));
        assert!(text.contains("title: Pricing"));
        assert!(text.contains("body stays"));
    }

    #[test]
    fn tags_are_replaced_not_appended() {
        let path = scratch("replace");
        std::fs::write(&path, NOTE).unwrap();

        write(&path, &["one".into()]).unwrap();
        write(&path, &["two".into()]).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read(&text), vec!["two"]);
        assert!(!text.contains("one"), "the old tag survived:\n{text}");
    }

    #[test]
    fn clearing_removes_the_key_entirely() {
        // `tags:` with nothing under it is not valid YAML.
        let path = scratch("clear");
        std::fs::write(&path, NOTE).unwrap();
        write(&path, &["one".into()]).unwrap();

        write(&path, &[]).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("tags:"), "empty key left behind:\n{text}");
        assert!(read(&text).is_empty());
        assert!(text.contains("body stays"));
    }

    #[test]
    fn duplicates_collapse_however_they_were_typed() {
        let path = scratch("dupes");
        std::fs::write(&path, NOTE).unwrap();

        let written = write(
            &path,
            &["Pricing".into(), "  pricing".into(), "PRICING".into()],
        )
        .unwrap();
        assert_eq!(written, vec!["pricing"]);
    }

    #[test]
    fn the_body_is_never_reparsed() {
        // A body containing something that looks like frontmatter must not
        // confuse the rewriter — the note body is deliberately opaque.
        let path = scratch("body");
        let tricky = "---\nid: s\ntitle: T\n---\n\n# T\n\n---\ntags:\n  - not-a-tag\n---\n";
        std::fs::write(&path, tricky).unwrap();

        write(&path, &["real".into()]).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read(&text), vec!["real"]);
        assert!(text.contains("not-a-tag"), "the body was edited:\n{text}");
    }

    #[test]
    fn a_failed_write_leaves_the_note_intact() {
        // An earlier version truncated the file before writing the new
        // content. Every test still passed, because the write that followed
        // always succeeded — and a note would have been destroyed the first
        // time one did not.
        let path = scratch("failed-write");
        std::fs::write(&path, NOTE).unwrap();

        // A directory where the note should be makes the write fail without
        // needing permissions games.
        let blocked = path.with_file_name("blocked.md");
        std::fs::create_dir_all(&blocked).unwrap();
        assert!(write(&blocked, &["x".into()]).is_err());

        // And the real note, untouched by any of it.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), NOTE);
    }

    #[test]
    fn a_file_without_frontmatter_is_left_alone() {
        let path = scratch("no-fm");
        std::fs::write(&path, "just some text\n").unwrap();

        write(&path, &["x".into()]).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "just some text\n");
    }
}
