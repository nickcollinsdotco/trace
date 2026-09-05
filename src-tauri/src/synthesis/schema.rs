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

/// JSON Schema handed to Ollama's `format` field.
///
/// `additionalProperties: false` throughout, so the model cannot invent fields
/// alongside the ones it was asked for. `minItems: 1` on every `evidence`
/// array makes an uncited claim ungeneratable rather than merely discouraged —
/// the constraint is enforced during decoding, not checked afterwards.
pub fn json_schema() -> serde_json::Value {
    let claim = serde_json::json!({
        "type": "object",
        "properties": {
            "text": { "type": "string" },
            "evidence": {
                "type": "array",
                "items": { "type": "string" },
                "minItems": 1
            },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["text", "evidence", "confidence"],
        "additionalProperties": false
    });

    let action = serde_json::json!({
        "type": "object",
        "properties": {
            "text": { "type": "string" },
            "owner": { "type": ["string", "null"] },
            "evidence": {
                "type": "array",
                "items": { "type": "string" },
                "minItems": 1
            },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["text", "evidence", "confidence"],
        "additionalProperties": false
    });

    serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "key_points": { "type": "array", "items": claim },
            "decisions": { "type": "array", "items": claim },
            "action_items": { "type": "array", "items": action },
            "open_questions": { "type": "array", "items": claim }
        },
        "required": ["summary", "key_points", "decisions", "action_items", "open_questions"],
        "additionalProperties": false
    })
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
