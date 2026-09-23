//! What the user tells TRACE about a meeting after it has ended.
//!
//! Two things, both of which the recording cannot know: what kind of meeting
//! it was ("this was an interview for the design lead role"), and who was on
//! the other end. Either changes what a good summary says, so both feed the
//! next regeneration.
//!
//! Both live in frontmatter, beside the title and tags, and for the same
//! reason: they are the user's edits to a finished note, and the file is where
//! a Markdown-on-disk product keeps those. The journal stays a record of what
//! happened in the meeting, and `rewrite_note` lays these back over it —
//! exactly as it already does for a rename.

use std::path::Path;

use super::{markdown, paths, StoreError};

/// The user's additions to one note.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct NoteContext {
    /// Free text about the meeting. Empty when none was given.
    pub context: String,
    /// The people behind `them`, in the order the user gave them.
    pub participants: Vec<String>,
}

pub fn read(text: &str) -> NoteContext {
    NoteContext {
        context: markdown::frontmatter_value(text, "context").unwrap_or_default(),
        participants: markdown::frontmatter_list(text, "participants"),
    }
}

/// Replace a note's context and participants, leaving the rest of the file
/// untouched.
///
/// Names are trimmed and de-duplicated but keep their case and order — unlike
/// tags, a name is not a grouping key, and "Sarah" typed first is who the user
/// thinks of first. Returns what was stored, so the UI shows the file.
pub fn write(
    note_path: &Path,
    context: &str,
    participants: &[String],
) -> Result<NoteContext, StoreError> {
    let text = std::fs::read_to_string(note_path)?;

    let context = context.trim();
    let mut names: Vec<String> = Vec::new();
    for name in participants.iter().map(|n| n.trim()) {
        if !name.is_empty() && !names.iter().any(|n| n.eq_ignore_ascii_case(name)) {
            names.push(name.to_string());
        }
    }

    let updated = markdown::replace_frontmatter_scalar(
        &text,
        "context",
        Some(context).filter(|c| !c.is_empty()),
    );
    let updated = markdown::replace_frontmatter_list(&updated, "participants", &names);
    paths::write_atomic(note_path, &updated)?;

    Ok(NoteContext {
        context: context.to_string(),
        participants: names,
    })
}

/// Lay the user's edits to a note over a meeting replayed from its journal.
///
/// The journal never hears about a rename, tags, context or names — all are
/// made to the file afterwards — so replaying it verbatim would quietly undo
/// them the moment notes were regenerated. The file wins for every one.
pub fn apply_edits(meeting: &mut crate::meeting::Meeting, text: &str) {
    if let Some(title) = markdown::frontmatter_value(text, "title") {
        meeting.title = title;
    }
    meeting.tags = super::tags::read(text);

    let edits = read(text);
    meeting.context = Some(edits.context).filter(|c| !c.trim().is_empty());
    meeting.participants = edits.participants;
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\nid: sess-1\ntitle: Huspy\ndate: 2026-09-06\ntags:\n  - hiring\n---\n\n# Huspy\n\nbody stays\n";

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-context-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("note.md")
    }

    #[test]
    fn context_and_names_round_trip_and_nothing_else_moves() {
        let path = scratch("round-trip");
        std::fs::write(&path, NOTE).unwrap();

        let stored = write(
            &path,
            "  This was an interview.\nSecond round, for the design lead role: portfolio review.  ",
            &["Amira".into(), " amira ".into(), "Tom".into(), "".into()],
        )
        .unwrap();

        assert_eq!(stored.participants, vec!["Amira", "Tom"]);
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read(&text), stored);
        assert_eq!(
            read(&text).context,
            "This was an interview.\nSecond round, for the design lead role: portfolio review."
        );
        // The context is one frontmatter line however many it had.
        assert_eq!(
            text.lines().filter(|l| l.starts_with("context:")).count(),
            1
        );
        assert_eq!(super::super::tags::read(&text), vec!["hiring"]);
        assert!(text.contains("title: Huspy"));
        assert!(text.ends_with("# Huspy\n\nbody stays\n"), "got:\n{text}");
    }

    #[test]
    fn clearing_removes_both_keys() {
        let path = scratch("clear");
        std::fs::write(&path, NOTE).unwrap();
        write(&path, "an interview", &["Amira".into()]).unwrap();

        write(&path, "   ", &[]).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("context:"), "got:\n{text}");
        assert!(!text.contains("participants:"), "got:\n{text}");
        assert_eq!(read(&text), NoteContext::default());
    }

    #[test]
    fn names_typed_inline_in_another_editor_are_read() {
        let text = "---\nid: s\nparticipants: [Amira, \"Tom O'Neill\"]\n---\n";
        assert_eq!(read(text).participants, vec!["Amira", "Tom O'Neill"]);
    }

    #[test]
    fn a_backslash_before_an_n_is_not_a_line_break() {
        let path = scratch("backslash");
        std::fs::write(&path, NOTE).unwrap();
        write(&path, r"see C:\notes and\nthis", &[]).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read(&text).context, r"see C:\notes and\nthis");
    }

    #[test]
    fn edits_on_disk_win_over_the_journal() {
        let path = scratch("apply");
        std::fs::write(&path, NOTE).unwrap();
        write(&path, "an interview", &["Amira".into()]).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();

        let mut meeting = crate::meeting::Meeting::new("sess-1", "Untitled meeting");
        apply_edits(&mut meeting, &text);

        assert_eq!(meeting.title, "Huspy");
        assert_eq!(meeting.tags, vec!["hiring"]);
        assert_eq!(meeting.context.as_deref(), Some("an interview"));
        assert_eq!(meeting.participants, vec!["Amira"]);
    }
}
