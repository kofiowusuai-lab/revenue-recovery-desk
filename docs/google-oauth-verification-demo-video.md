# Google OAuth verification demo video workflow

Use this when Google verification asks for a demo video for Revenue Recovery Desk / FlowAudit Google Workspace scopes.

## Locked demo identity

- Product/app name for narration: `Revenue Recovery Desk` unless the operator says otherwise.
- Public page to show first: `https://flowaudit.co.uk/revenue-recovery`.
- Current Google Workspace scopes that trigger verification:
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/drive.metadata.readonly`

## Voiceover preference

If the operator asks for an ElevenLabs voiceover, use their ElevenLabs voice named `Kofi PVC` when available. In one session the API returned it as `Kofi Professional Clone`; select by exact configured voice name first, then by a case-insensitive `kofi` match.

Never paste or echo ElevenLabs keys in chat or shell commands. If the key appears in chat, recommend rotating it. Prefer a local-only browser installer page that writes `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_NAME=Kofi PVC`, and the resolved `ELEVENLABS_VOICE_ID` into the recoverydesk profile `.env`, then only report key-name presence / selected voice name.

## Suggested video structure

1. Show the official FlowAudit Revenue Recovery page.
2. Show onboarding / user-initiated connect context.
3. Show or recreate the Google consent step with the exact requested scopes.
4. Explain Gmail readonly:
   - used to review relevant invoice, payment, dispute, reply, and customer communication context;
   - not used to send, delete, or modify Gmail data.
5. Explain Drive metadata readonly:
   - used to locate relevant invoice folders, SOPs, payment records, recovery templates, and supporting documents by file/folder metadata;
   - not used to download, edit, delete, sync, or back up Drive files.
6. Show connected/return state and controls: human-reviewed recovery workflow, approval-gated outreach, disconnect/offboard controls.

## Minimal compliance-friendly narration

```text
This demo shows how Revenue Recovery Desk uses Google data in the FlowAudit revenue recovery workflow.

A business user starts on the official FlowAudit Revenue Recovery page at flowaudit.co.uk/revenue-recovery. The onboarding form explains that Revenue Recovery Desk sets up a dedicated recovery agent to help identify overdue revenue, organize follow-up, and keep the business in control.

When the user chooses to connect Google Workspace, the connection is initiated by the user. Revenue Recovery Desk requests read-only Gmail access and read-only Google Drive metadata access.

Gmail read-only is used to review relevant invoice, payment, and customer communication context for revenue recovery. The app does not send, delete, or modify email through this scope.

Google Drive metadata read-only is used to locate relevant file and folder metadata, such as invoice folders, payment records, SOPs, and recovery templates. The app does not download, edit, delete, sync, or back up Drive files through this scope.

After authorization, the user returns to Revenue Recovery Desk and the Google Workspace connection is shown as connected. The recovered context supports human-reviewed revenue recovery workflows. Outreach remains approval-gated, and the business can disconnect or offboard access through the FlowAudit controls.

Revenue Recovery Desk only uses Google data after explicit user authorization, only for business revenue recovery, and only with the read-only permissions shown in this demo.
```

## Practical build pattern

- Capture live pages or browser frames at 1920x1080.
- If the real OAuth flow cannot be safely recorded without exposing account details, create neutral mock/illustrative slides that show the same scope names and product behavior without secrets.
- Generate TTS with ElevenLabs using the resolved Kofi voice.
- Assemble with `ffmpeg` to H.264 + AAC and verify with `ffprobe`:
  - video stream: H.264, 1920x1080
  - audio stream: AAC
  - duration and file size present
- Deliver the `.mp4` as a media attachment.

## Google form wording reminder

For final verification questionnaire answers:
- Personal use only: `No`
- Internal use only: `No`
- Development/testing/staging only: `No`
- Gmail SMTP WordPress plugin only: `No`
- Acknowledge restricted-scope/CASA requirements if Gmail readonly is requested.
