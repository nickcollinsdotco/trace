# Data Model

## Meeting

```ts
type Meeting = {
  id: string
  title: string
  date: string
  startedAt?: string
  endedAt?: string
  type?: MeetingType
  participants: Participant[]
  tags: string[]
  project?: string
  notes: string
  transcript: TranscriptSegment[]
  generated?: GeneratedMeeting
  status: "draft" | "active" | "processing" | "complete" | "error"
}
```

## Transcript segment

```ts
type TranscriptSegment = {
  id: string
  startMs: number
  endMs?: number
  speaker?: string
  text: string
  source?: "microphone" | "system" | "unknown"
}
```

Do not over-engineer speaker diarisation initially.

## Action item

```ts
type ActionItem = {
  id: string
  text: string
  owner?: string
  dueDate?: string
  confidence?: number
  completed?: boolean
}
```

The confidence field is especially useful for AI-generated action items. The UI should not present uncertain AI guesses as established facts.

## Generated meeting

```ts
type GeneratedMeeting = {
  summary: string
  keyPoints: string[]
  decisions: string[]
  actionItems: ActionItem[]
  openQuestions: string[]
  quotes?: Quote[]
}
```

## Markdown rendering

Keep a deterministic serializer:

```text
structured Meeting
      ↓
Markdown serializer
      ↓
meeting.md
```

And a parser:

```text
meeting.md
      ↓
Markdown parser
      ↓
Meeting
```

Round-tripping should be tested heavily.

The user should never lose edits because the AI re-ran.
