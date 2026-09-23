//! The structured shape a model must produce, and its JSON Schema.
//!
//! # Why a schema at all
//!
//! Asking a model for Markdown and parsing the result is the obvious approach
//! and the wrong one: the output is unconstrained, so every failure is a
//! parsing problem discovered after the fact. Constraining generation instead
//! makes malformed output impossible rather than merely unlikely.
//!
//! Ollama accepts a JSON Schema in its `format` field and applies it as a
//! grammar during decoding, so invalid tokens are masked at each step. The
//! schema below is that constraint.
//!
//! # Why every claim must cite
//!
//! `docs/00-README.md` requires that the AI must not invent decisions,
//! actions, attendees or facts. A prompt asking it not to is a request. A
//! schema that makes `evidence` a required, non-empty array of segment ids —
//! checked afterwards against the segments that actually exist — is a
//! mechanism. Anything the model fabricates has to cite something, and a
//! fabricated citation does not resolve.
//!
//! This answers open question AI-4 in `docs/07-OPEN-QUESTIONS.md`.

use serde::{Deserialize, Serialize};

/// What the model is asked to return.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SynthesisOutput {
    pub summary: String,
    #[serde(default)]
    pub key_points: Vec<RawClaim>,
    #[serde(default)]
    pub decisions: Vec<RawClaim>,
    #[serde(default)]
    pub action_items: Vec<RawAction>,
    #[serde(default)]
    pub open_questions: Vec<RawClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawClaim {
    pub text: String,
    /// Transcript segment ids supporting this. Required and non-empty.
    #[serde(default)]
    pub evidence: Vec<String>,
    /// 0..=1. The model's own confidence, used to de-emphasise weak items
    /// rather than to filter them — filtering is evidence's job.
    #[serde(default)]
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawAction {
    pub text: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub confidence: f32,
}

/// The shape of a citable id: `mic_0004`, `sys_0011`, `note_0000`.
///
/// Four or more digits because the counters are zero-padded to four but do
/// not stop at 9,999.
pub const EVIDENCE_PATTERN: &str = "^(mic|sys|note)_[0-9]{4,}$";

/// Longest a single generated item may be, in characters.
///
/// A bound on runaway output rather than a style rule. A model that starts
/// copying a transcript line — "uh uh uh uh…" included — into a field would
/// otherwise keep going until the token limit cut the JSON off mid-string,
/// losing every item from that part of the meeting.
const ITEM_MAX_CHARS: u32 = 400;
const SUMMARY_MAX_CHARS: u32 = 2_000;
/// More citations than this for one item is copying, not evidence.
const EVIDENCE_MAX_ITEMS: u32 = 8;

/// JSON Schema handed to Ollama's `format` field.
///
/// `additionalProperties: false` throughout, so the model cannot invent fields
/// alongside the ones it was asked for. `minItems: 1` on every `evidence`
/// array makes an uncited claim ungeneratable rather than merely discouraged —
/// the constraint is enforced during decoding, not checked afterwards.
///
/// Each evidence item is held to the id pattern for the same reason. With
/// only `"type": "string"`, a model once wrote a whole transcript line as its
/// citation, followed the speaker's repeated "uh" into a loop, and ran out of
/// tokens before closing the JSON.
pub fn json_schema() -> serde_json::Value {
    let evidence = serde_json::json!({
        "type": "array",
        "items": { "type": "string", "pattern": EVIDENCE_PATTERN },
        "minItems": 1,
        "maxItems": EVIDENCE_MAX_ITEMS
    });

    let text = serde_json::json!({ "type": "string", "maxLength": ITEM_MAX_CHARS });

    let claim = serde_json::json!({
        "type": "object",
        "properties": {
            "text": text,
            "evidence": evidence,
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["text", "evidence", "confidence"],
        "additionalProperties": false
    });

    let action = serde_json::json!({
        "type": "object",
        "properties": {
            "text": text,
            "owner": { "type": ["string", "null"], "maxLength": 60 },
            "evidence": evidence,
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["text", "evidence", "confidence"],
        "additionalProperties": false
    });

    serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string", "maxLength": SUMMARY_MAX_CHARS },
            "key_points": { "type": "array", "items": claim },
            "decisions": { "type": "array", "items": claim },
            "action_items": { "type": "array", "items": action },
            "open_questions": { "type": "array", "items": claim }
        },
        "required": ["summary", "key_points", "decisions", "action_items", "open_questions"],
        "additionalProperties": false
    })
}

/// The schema without the constraints some Ollama versions refuse.
///
/// `pattern`, `maxLength` and `maxItems` are what stop a runaway citation, but
/// an Ollama that cannot turn them into a grammar rejects the whole request
/// with a 400 — which is worse than the problem they solve, because then
/// nothing is generated at all. Without them the structure is still enforced,
/// and every citation is still checked against the transcript afterwards.
pub fn relaxed(schema: &serde_json::Value) -> serde_json::Value {
    match schema {
        serde_json::Value::Object(map) => map
            .iter()
            .filter(|(k, _)| !matches!(k.as_str(), "pattern" | "maxLength" | "maxItems"))
            .map(|(k, v)| (k.clone(), relaxed(v)))
            .collect::<serde_json::Map<_, _>>()
            .into(),
        serde_json::Value::Array(items) => items.iter().map(relaxed).collect(),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_forbids_uncited_claims() {
        let schema = json_schema();
        let claim = &schema["properties"]["decisions"]["items"];

        // The constraint that makes fabrication expensive: a claim cannot be
        // generated at all without at least one citation.
        assert_eq!(claim["properties"]["evidence"]["minItems"], 1);
        assert!(claim["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("evidence")));
    }

    /// The pattern, checked by hand: no regex crate for one test.
    fn matches_evidence_pattern(id: &str) -> bool {
        let Some((prefix, digits)) = id.split_once('_') else {
            return false;
        };
        ["mic", "sys", "note"].contains(&prefix)
            && digits.len() >= 4
            && digits.chars().all(|c| c.is_ascii_digit())
    }

    #[test]
    fn every_id_the_app_writes_fits_the_evidence_pattern() {
        // If a new id format is added and the pattern is not widened, the
        // grammar would make that source uncitable and every claim from it
        // would vanish.
        assert_eq!(EVIDENCE_PATTERN, "^(mic|sys|note)_[0-9]{4,}$");

        let notes = super::super::citable::note_lines("first\nsecond");
        for n in &notes {
            assert!(matches_evidence_pattern(&n.id), "{}", n.id);
        }
        for id in ["mic_0000", "sys_0109", "sys_12345"] {
            assert!(matches_evidence_pattern(id), "{id}");
        }
        // What the model actually produced before the pattern existed.
        assert!(!matches_evidence_pattern(
            "sys_0109] (08:42) them: Oh yes, and then there is a uh uh uh"
        ));
    }

    #[test]
    fn every_evidence_item_is_held_to_the_id_pattern() {
        let schema = json_schema();
        for section in ["key_points", "decisions", "action_items", "open_questions"] {
            let evidence = &schema["properties"][section]["items"]["properties"]["evidence"];
            assert_eq!(evidence["items"]["pattern"], EVIDENCE_PATTERN, "{section}");
            assert!(evidence["maxItems"].is_u64(), "{section}");
        }
    }

    #[test]
    fn every_generated_string_is_bounded() {
        let schema = json_schema();
        assert!(schema["properties"]["summary"]["maxLength"].is_u64());
        for section in ["key_points", "decisions", "action_items", "open_questions"] {
            let text = &schema["properties"][section]["items"]["properties"]["text"];
            assert!(text["maxLength"].is_u64(), "{section}");
        }
    }

    #[test]
    fn the_relaxed_schema_drops_only_the_optional_constraints() {
        let strict = json_schema();
        let loose = relaxed(&strict);
        let text = loose.to_string();

        assert!(!text.contains("pattern"));
        assert!(!text.contains("maxLength"));
        assert!(!text.contains("maxItems"));
        // What makes the output usable at all survives.
        let evidence = &loose["properties"]["decisions"]["items"]["properties"]["evidence"];
        assert_eq!(evidence["minItems"], 1);
        assert_eq!(loose["additionalProperties"], false);
        assert_eq!(loose["required"], strict["required"]);
    }

    #[test]
    fn schema_forbids_invented_fields() {
        let schema = json_schema();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            schema["properties"]["decisions"]["items"]["additionalProperties"],
            false
        );
    }

    #[test]
    fn schema_requires_every_section() {
        // Absent sections would be indistinguishable from empty ones, and
        // "the model forgot" reads very differently from "there were none".
        let schema = json_schema();
        let required: Vec<&str> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();

        for section in [
            "summary",
            "key_points",
            "decisions",
            "action_items",
            "open_questions",
        ] {
            assert!(required.contains(&section), "{section} must be required");
        }
    }

    #[test]
    fn output_deserialises_from_a_well_formed_response() {
        let json = r#"{
            "summary": "We discussed pricing.",
            "key_points": [],
            "decisions": [
                { "text": "Ship on Friday", "evidence": ["mic_0004"], "confidence": 0.9 }
            ],
            "action_items": [
                { "text": "send the deck", "owner": "Sarah", "evidence": ["sys_0002"], "confidence": 0.8 }
            ],
            "open_questions": []
        }"#;

        let out: SynthesisOutput = serde_json::from_str(json).unwrap();
        assert_eq!(out.decisions.len(), 1);
        assert_eq!(out.decisions[0].evidence, vec!["mic_0004"]);
        assert_eq!(out.action_items[0].owner.as_deref(), Some("Sarah"));
    }

    #[test]
    fn missing_sections_deserialise_as_empty() {
        // The schema requires them, but a model behind a proxy that ignores
        // the grammar should degrade rather than fail outright.
        let out: SynthesisOutput = serde_json::from_str(r#"{"summary":"x"}"#).unwrap();
        assert_eq!(out.summary, "x");
        assert!(out.decisions.is_empty());
    }

    #[test]
    fn an_owner_is_optional() {
        let json = r#"{"summary":"","key_points":[],"decisions":[],
            "action_items":[{"text":"do it","evidence":["a"],"confidence":0.5}],
            "open_questions":[]}"#;
        let out: SynthesisOutput = serde_json::from_str(json).unwrap();
        assert_eq!(out.action_items[0].owner, None);
    }
}
