//! Building prompts from a meeting.
//!
//! The transcript is presented as *labelled, citable lines* rather than prose,
//! because the model has to reference ids and cannot cite what it cannot see:
//!
//! ```text
//! [note_0000] pricing tiers confusing
//! [mic_0004] (01:12) you: shall we ship on friday
//! [sys_0011] (01:15) them: yes, let us do that
//! ```
//!
//! Speaker labels come from the audio topology — microphone is the local user,
//! system audio is everyone else — so they are facts about which device
//! recorded the words, not a guess the model has to make.
//!
//! # Nothing is dropped
//!
//! A transcript too long for one request is **split into windows**, not
//! truncated. Every line appears in exactly one window, each window is
//! extracted independently, and the results are merged. An earlier version
//! kept only the last 24,000 characters, which silently discarded the middle
//! of any long meeting — the wrong trade for a tool whose job is not losing
//! things.

use crate::meeting::Meeting;
use crate::transcribe::Segment;

use super::citable::note_lines;

/// Characters of notes plus transcript per window.
///
/// A rough proxy for tokens, chosen conservatively: local models advertise
/// large context windows but degrade well before filling them. It also sets
/// memory: Ollama reserves its KV cache for the whole context up front, about
/// 144 KB per token for an 8B model, so this size is what lets
/// `ollama::NUM_CTX` stay at 8k (~1.1 GB) rather than 16k (~2.3 GB) — the
/// difference between fitting beside the model on an 8 GB card and spilling
/// onto the CPU. A long meeting becomes more windows instead.
pub const WINDOW_CHARS: usize = 10_000;

/// Least transcript per window, however long the notes are.
///
/// Without a floor, pages of typed notes would shrink every window to a line
/// or two. Past this the prompt may overflow the context, which the provider
/// detects and reports rather than truncating silently.
const MIN_TRANSCRIPT_CHARS: usize = 4_000;

pub const SYSTEM_PROMPT: &str = "\
You extract structure from meeting transcripts. You are precise and \
conservative.

Rules:
- Every claim you make must cite the line ids it came from.
- Only cite ids that appear in the input. Never invent an id.
- Evidence is a list of bare ids such as sys_0012 or note_0003 — never the \
text of the line, its timestamp, or its brackets.
- Prefer omitting an item to guessing at one. An empty list is a valid and \
often correct answer.
- A decision is a question the participants closed: an option chosen, a \
course settled on. It is not something they merely discussed or considered.
- Agreeing to talk about something later does not close a question. \
'We should discuss pricing' and 'let's look at that next week' are not \
decisions; they are action items or open questions. Put them there instead.
- An action item is something a person committed to doing. If nobody \
committed, it is not an action item.
- Lines labelled 'you' were spoken by the user; lines labelled 'them' were \
spoken by others. Lines starting with note_ were typed by the user during \
the meeting and are especially significant.
- Write in plain past tense. Do not editorialise or add advice.
- Set confidence honestly: 0.9+ only when the input states it plainly.";

/// One request's worth of a meeting.
#[derive(Debug, Clone)]
pub struct Window {
    pub prompt: String,
    /// 1-based position, for progress reporting.
    pub index: usize,
    pub total: usize,
}

/// Split a meeting into windows that each fit a single request.
///
/// Always returns at least one window, even for an empty transcript, so
/// callers do not need a special case.
pub fn windows(meeting: &Meeting) -> Vec<Window> {
    let notes = render_notes(meeting);
    let lines = transcript_lines(&meeting.transcript);

    // The notes are repeated in every window: they are the user's own signal
    // about what mattered, and a window that could not see them would extract
    // worse than one that could. So they come out of each window's budget,
    // rather than being assumed small.
    let budget = WINDOW_CHARS
        .saturating_sub(notes.len())
        .max(MIN_TRANSCRIPT_CHARS);
    let groups = group_lines(&lines, budget);
    let total = groups.len().max(1);

    if groups.is_empty() {
        return vec![Window {
            prompt: assemble(meeting, &notes, "", 1, 1),
            index: 1,
            total: 1,
        }];
    }

    groups
        .into_iter()
        .enumerate()
        .map(|(i, body)| Window {
            prompt: assemble(meeting, &notes, &body, i + 1, total),
            index: i + 1,
            total,
        })
        .collect()
}

/// Pack lines into groups no larger than `max_chars`.
///
/// A single line longer than the budget still gets its own group rather than
/// being split mid-sentence or dropped.
fn group_lines(lines: &[String], max_chars: usize) -> Vec<String> {
    let mut groups = Vec::new();
    let mut current = String::new();

    for line in lines {
        if !current.is_empty() && current.len() + line.len() > max_chars {
            groups.push(std::mem::take(&mut current));
        }
        current.push_str(line);
    }

    if !current.is_empty() {
        groups.push(current);
    }
    groups
}

fn assemble(
    meeting: &Meeting,
    notes: &str,
    transcript: &str,
    index: usize,
    total: usize,
) -> String {
    let mut out = String::new();

    out.push_str(&format!("MEETING: {}\n", meeting.title));
    out.push_str(&format!("DATE: {}\n", meeting.date));
    // The labels stay `you` and `them` in the lines themselves: they are
    // facts about which device heard the words, and the system prompt defines
    // them. Names are said once here instead.
    match meeting.participants.as_slice() {
        [] => {}
        [only] => out.push_str(&format!(
            "THEM: every line labelled 'them' was spoken by {only}. Refer to \
             them as {only}.\n"
        )),
        several => out.push_str(&format!(
            "THEM: lines labelled 'them' were spoken by one of {}. The \
             recording cannot tell them apart, so name one only when the \
             transcript makes it plain who is speaking.\n",
            several.join(", ")
        )),
    }

    if total > 1 {
        // Told plainly, so the model does not summarise as though this were
        // the whole meeting or apologise for missing context.
        out.push_str(&format!(
            "\nThis is part {index} of {total} of a longer meeting. Extract only \
             what is present in this part.\n"
        ));
    }

    // Not citable, and said so: it is the user's framing after the fact, and
    // a claim resting on it would be a claim nobody made in the meeting.
    if let Some(context) = meeting.context.as_deref().filter(|c| !c.trim().is_empty()) {
        out.push_str(
            "\nCONTEXT FROM THE USER\n\
             Written after the meeting to explain it. Use it to understand what \
             kind of meeting this was and who was in it, and write the notes \
             for that. It is not part of the meeting: never cite it, and never \
             report it as something that was said.\n\n",
        );
        out.push_str(context.trim());
        out.push('\n');
    }

    if !notes.is_empty() {
        out.push_str(
            "\nNOTES TYPED BY THE USER DURING THE MEETING\n\
             These are citable and carry high signal — the user chose to write \
             them down.\n\n",
        );
        out.push_str(notes);
    }

    out.push_str("\nTRANSCRIPT\n\n");
    if transcript.is_empty() {
        out.push_str("(no speech was transcribed)\n");
    } else {
        out.push_str(transcript);
    }

    out.push_str("\nExtract the structure. Cite ids exactly as they appear above.\n");
    out
}

fn render_notes(meeting: &Meeting) -> String {
    note_lines(&meeting.notes)
        .iter()
        .map(|n| format!("[{}] {}\n", n.id, n.text))
        .collect()
}

fn transcript_lines(segments: &[Segment]) -> Vec<String> {
    segments
        .iter()
        .filter(|s| !s.text.trim().is_empty())
        .map(|s| {
            format!(
                "[{}] ({}) {}: {}\n",
                s.id,
                timestamp(s.start_ms),
                s.speaker_label(),
                collapse_repeats(s.text.trim())
            )
        })
        .collect()
}

/// Longest run of one repeated word kept in the prompt.
const MAX_REPEATS: usize = 3;

/// Shorten runs of a repeated word: "a uh uh uh uh uh head" → "a uh uh uh… head".
///
/// Prompt-only; the saved transcript is untouched. Speech recognition
/// sometimes emits a filler dozens of times over, and a model reading that is
/// primed to continue it — which is how one ran out of tokens mid-answer,
/// writing "uh" into a citation. Three is kept rather than one so a genuine
/// stammer still reads as one.
fn collapse_repeats(text: &str) -> String {
    let normalise = |w: &str| {
        w.trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase()
    };

    let mut out: Vec<String> = Vec::new();
    let mut run = 0;
    let mut previous = String::new();

    for word in text.split_whitespace() {
        let key = normalise(word);
        if !key.is_empty() && key == previous {
            run += 1;
        } else {
            run = 1;
            previous = key;
        }

        if run <= MAX_REPEATS {
            out.push(word.to_string());
        } else if run == MAX_REPEATS + 1 {
            if let Some(last) = out.last_mut() {
                last.push('…');
            }
        }
    }
    out.join(" ")
}

/// Fewest key points the final pass is asked for.
pub const KEY_POINTS_MIN: usize = 6;
/// Most key points a note keeps. A one-hour meeting once produced 49 — every
/// window's list stacked — which is a transcript index, not a summary.
pub const KEY_POINTS_MAX: usize = 10;

pub const CONDENSE_SYSTEM_PROMPT: &str = "\
You condense notes from one meeting into what someone who missed it needs. \
You are precise and conservative.

Rules:
- Use only what is in the input. Add nothing.
- Every key point lists the numbers of the input points it came from.
- Write in plain past tense. Do not mention that the meeting was summarised \
in parts.";

/// Prompt for the final pass over a meeting summarised in several windows.
///
/// Input is the windows' summaries and key points, not transcript, so it
/// stays small however long the meeting was. Key points are numbered so the
/// answer can refer to them; see `schema::CondenseOutput` for why.
pub fn condense_prompt(summaries: &[String], key_points: &[String]) -> String {
    let mut out =
        String::from("These are notes from consecutive parts of one meeting.\n\nSUMMARIES\n\n");
    for (i, s) in summaries.iter().enumerate() {
        out.push_str(&format!("PART {}\n{}\n\n", i + 1, s.trim()));
    }

    out.push_str("KEY POINTS\n\n");
    for (i, p) in key_points.iter().enumerate() {
        out.push_str(&format!("[{i}] {}\n", p.trim()));
    }

    out.push_str(&format!(
        "\nWrite one summary of the whole meeting in three to five sentences.\n\n\
         Then choose the {KEY_POINTS_MIN} to {KEY_POINTS_MAX} key points that matter most. \
         Merge points that say the same thing into one. Fewer is right if the \
         meeting had less substance. For each, give its text and the numbers of \
         the points above it came from.\n"
    ));
    out
}

fn timestamp(ms: u64) -> String {
    let total = ms / 1000;
    format!("{:02}:{:02}", total / 60, total % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::StreamSource;

    fn segment(id: &str, ms: u64, text: &str, source: StreamSource) -> Segment {
        Segment {
            id: id.into(),
            start_ms: ms,
            end_ms: ms + 1000,
            text: text.into(),
            source,
        }
    }

    fn meeting_with(segments: Vec<Segment>) -> Meeting {
        let mut m = Meeting::new("m1", "Client Alpha");
        m.date = "2026-09-05".into();
        m.transcript = segments;
        m
    }

    #[test]
    fn context_is_given_to_every_window_but_is_not_citable() {
        let mut m = meeting_with(vec![segment(
            "sys_0000",
            0,
            "tell me about your last role",
            StreamSource::System,
        )]);
        m.context = Some("This was an interview for the design lead role.".into());
        let prompt = &windows(&m)[0].prompt;

        assert!(prompt.contains("CONTEXT FROM THE USER"));
        assert!(prompt.contains("This was an interview for the design lead role."));
        assert!(prompt.contains("never cite it"));
        // No id, so nothing can cite it.
        assert!(!prompt.contains("] This was an interview"));
    }

    #[test]
    fn no_context_means_no_context_section() {
        let m = meeting_with(vec![segment(
            "mic_0000",
            0,
            "hello",
            StreamSource::Microphone,
        )]);
        assert!(!windows(&m)[0].prompt.contains("CONTEXT FROM THE USER"));
        assert!(!windows(&m)[0].prompt.contains("THEM:"));
    }

    #[test]
    fn one_name_says_who_them_is() {
        let mut m = meeting_with(vec![segment("sys_0000", 0, "hi", StreamSource::System)]);
        m.participants = vec!["Amira".into()];
        let prompt = &windows(&m)[0].prompt;
        assert!(prompt.contains("spoken by Amira"), "got:\n{prompt}");
        // The line keeps its factual label.
        assert!(prompt.contains("[sys_0000] (00:00) them: hi"));
    }

    #[test]
    fn several_names_are_not_attributed_to_lines() {
        let mut m = meeting_with(vec![segment("sys_0000", 0, "hi", StreamSource::System)]);
        m.participants = vec!["Amira".into(), "Tom".into()];
        let prompt = &windows(&m)[0].prompt;
        assert!(prompt.contains("one of Amira, Tom"), "got:\n{prompt}");
        assert!(prompt.contains("cannot tell them apart"));
    }

    #[test]
    fn runaway_repeats_are_shortened_in_the_prompt() {
        assert_eq!(
            collapse_repeats("there is a uh uh uh uh uh uh uh head of backend"),
            "there is a uh uh uh… head of backend"
        );
    }

    #[test]
    fn short_repeats_and_ordinary_speech_are_left_alone() {
        assert_eq!(collapse_repeats("no no no, not that"), "no no no, not that");
        assert_eq!(collapse_repeats("that that is fine"), "that that is fine");
        assert_eq!(collapse_repeats(""), "");
    }

    #[test]
    fn repeats_differing_only_in_case_or_punctuation_count_as_one_run() {
        assert_eq!(
            collapse_repeats("Uh, uh uh. uh uh okay"),
            "Uh, uh uh.… okay"
        );
    }

    #[test]
    fn transcript_lines_are_citable_and_labelled() {
        let m = meeting_with(vec![
            segment(
                "mic_0000",
                72_000,
                "shall we ship friday",
                StreamSource::Microphone,
            ),
            segment("sys_0001", 75_000, "yes lets", StreamSource::System),
        ]);
        let w = windows(&m);
        assert_eq!(w.len(), 1);
        assert!(w[0]
            .prompt
            .contains("[mic_0000] (01:12) you: shall we ship friday"));
        assert!(w[0].prompt.contains("[sys_0001] (01:15) them: yes lets"));
    }

    #[test]
    fn notes_are_presented_as_citable_lines() {
        // The fix for notes being unusable as grounds: they now have ids.
        let mut m = meeting_with(vec![segment("mic_0000", 0, "hi", StreamSource::Microphone)]);
        m.notes = "pricing unclear\nremove setup step".into();

        let prompt = &windows(&m)[0].prompt;
        assert!(prompt.contains("[note_0000] pricing unclear"));
        assert!(prompt.contains("[note_0001] remove setup step"));
        assert!(prompt.contains("citable"));
    }

    #[test]
    fn a_meeting_without_notes_omits_the_section() {
        let m = meeting_with(vec![segment("mic_0000", 0, "hi", StreamSource::Microphone)]);
        assert!(!windows(&m)[0].prompt.contains("NOTES TYPED BY THE USER"));
    }

    #[test]
    fn a_short_meeting_is_a_single_window() {
        let m = meeting_with(vec![segment(
            "mic_0000",
            0,
            "hello",
            StreamSource::Microphone,
        )]);
        let w = windows(&m);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].total, 1);
        // A single window must not claim to be part 1 of 1.
        assert!(!w[0].prompt.contains("part 1 of"));
    }

    #[test]
    fn a_long_meeting_splits_and_loses_nothing() {
        // The property that matters: every line survives somewhere.
        let segments: Vec<Segment> = (0..800)
            .map(|i| {
                segment(
                    &format!("mic_{i:04}"),
                    i * 1000,
                    "a line of transcript with some realistic length to it",
                    StreamSource::Microphone,
                )
            })
            .collect();
        let m = meeting_with(segments);

        let w = windows(&m);
        assert!(w.len() > 1, "should split, got {} window(s)", w.len());

        let combined: String = w.iter().map(|x| x.prompt.clone()).collect();
        for i in 0..800 {
            assert!(
                combined.contains(&format!("[mic_{i:04}]")),
                "line mic_{i:04} was lost"
            );
        }
    }

    #[test]
    fn each_line_appears_in_exactly_one_window() {
        // Duplicated lines would produce duplicated claims after merging.
        let segments: Vec<Segment> = (0..400)
            .map(|i| {
                segment(
                    &format!("mic_{i:04}"),
                    i * 1000,
                    "some words that take up a reasonable amount of room",
                    StreamSource::Microphone,
                )
            })
            .collect();
        let w = windows(&meeting_with(segments));

        for i in 0..400 {
            let needle = format!("[mic_{i:04}]");
            let count = w.iter().filter(|x| x.prompt.contains(&needle)).count();
            assert_eq!(count, 1, "mic_{i:04} appeared in {count} windows");
        }
    }

    #[test]
    fn windows_are_numbered_and_say_so() {
        let segments: Vec<Segment> = (0..600)
            .map(|i| {
                segment(
                    &format!("mic_{i:04}"),
                    i * 1000,
                    "a line of transcript with some realistic length to it",
                    StreamSource::Microphone,
                )
            })
            .collect();
        let w = windows(&meeting_with(segments));

        assert!(w[0].prompt.contains(&format!("part 1 of {}", w.len())));
        assert_eq!(w[0].index, 1);
        assert_eq!(w.last().unwrap().index, w.len());
    }

    #[test]
    fn notes_are_repeated_in_every_window() {
        // A window that could not see the user's notes would extract worse
        // than one that could, and the notes are cheap to include.
        let segments: Vec<Segment> = (0..600)
            .map(|i| {
                segment(
                    &format!("mic_{i:04}"),
                    i * 1000,
                    "a line of transcript with some realistic length to it",
                    StreamSource::Microphone,
                )
            })
            .collect();
        let mut m = meeting_with(segments);
        m.notes = "the thing that mattered".into();

        for window in windows(&m) {
            assert!(window
                .prompt
                .contains("[note_0000] the thing that mattered"));
        }
    }

    #[test]
    fn typed_notes_come_out_of_each_window_budget() {
        let segments: Vec<Segment> = (0..300)
            .map(|i| {
                segment(
                    &format!("mic_{i:04}"),
                    i * 1000,
                    "a line of transcript with some realistic length to it",
                    StreamSource::Microphone,
                )
            })
            .collect();
        let without = windows(&meeting_with(segments.clone())).len();

        let mut m = meeting_with(segments);
        m.notes = "a note that is long enough to matter\n".repeat(120);
        let with = windows(&m);

        assert!(with.len() > without, "{} windows vs {without}", with.len());
        let notes_len = render_notes(&m).len();
        for w in &with {
            // Headers aside, nothing exceeds the budget the notes left.
            assert!(w.prompt.len() <= WINDOW_CHARS.max(notes_len + MIN_TRANSCRIPT_CHARS) + 600);
        }
    }

    #[test]
    fn an_empty_meeting_still_yields_one_window() {
        let w = windows(&Meeting::new("m", "Empty"));
        assert_eq!(w.len(), 1);
        assert!(w[0].prompt.contains("no speech was transcribed"));
    }

    #[test]
    fn blank_segments_are_not_offered_as_citable() {
        let m = meeting_with(vec![
            segment("mic_0000", 0, "   ", StreamSource::Microphone),
            segment("mic_0001", 1000, "real words", StreamSource::Microphone),
        ]);
        let prompt = &windows(&m)[0].prompt;
        assert!(!prompt.contains("[mic_0000]"));
        assert!(prompt.contains("[mic_0001]"));
    }

    #[test]
    fn an_overlong_single_line_still_gets_a_window() {
        // Never silently drop a line just because it does not fit.
        let huge = "x".repeat(WINDOW_CHARS * 2);
        let m = meeting_with(vec![segment(
            "mic_0000",
            0,
            &huge,
            StreamSource::Microphone,
        )]);
        let w = windows(&m);
        assert!(w[0].prompt.contains("[mic_0000]"));
    }

    #[test]
    fn the_system_prompt_states_the_rules_that_matter() {
        assert!(SYSTEM_PROMPT.contains("Never invent an id"));
        assert!(SYSTEM_PROMPT.contains("An empty list is a valid"));
        assert!(SYSTEM_PROMPT.contains("not something they merely discussed"));
        // Deferring a conversation is the failure mode seen in practice:
        // the model read "start discussion on pricing" as a decision.
        assert!(SYSTEM_PROMPT.contains("does not close a question"));
        assert!(SYSTEM_PROMPT.contains("note_"));
    }

    #[test]
    fn the_final_pass_numbers_key_points_and_keeps_every_part() {
        let p = condense_prompt(
            &["First half.".into(), "Second half.".into()],
            &[
                "Pricing moves to three tiers".into(),
                "Hiring paused".into(),
            ],
        );
        assert!(p.contains("PART 1\nFirst half."));
        assert!(p.contains("PART 2\nSecond half."));
        assert!(p.contains("[0] Pricing moves to three tiers"));
        assert!(p.contains("[1] Hiring paused"));
        assert!(p.contains(&format!("{KEY_POINTS_MIN} to {KEY_POINTS_MAX}")));
    }
}
