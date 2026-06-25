# Google OAuth verification demo workflow for Revenue Recovery Desk

Use this when Google asks for OAuth app verification evidence, restricted/sensitive scope justifications, or a demo video for Revenue Recovery Desk.

## Current app identity and URLs

App name to use in verification copy/videos:

```text
Revenue Recovery Desk
```

Official product URL:

```text
https://flowaudit.co.uk/revenue-recovery
```

OAuth callback URL:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

## Scopes currently demonstrated

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/drive.metadata.readonly
```

Explain them as read-only, user-initiated business revenue recovery access:

- Gmail readonly: review invoice, payment, dispute, stop/contact, and customer-reply context before drafting recovery follow-up. Do **not** claim the app sends, deletes, or modifies Gmail through this scope.
- Drive metadata readonly: identify relevant invoice folders, SOPs, payment records, recovery templates, and support docs by file/folder metadata. Do **not** claim the app downloads, edits, deletes, syncs, or backs up Drive files through this scope.

## Verification form answer patterns

Use `Email productivity` for Gmail if Google asks for feature category. `Email client` can be acceptable if multiple are allowed and the app presents thread context, but avoid broader categories that imply backup/monitoring.

Use `Drive productivity` for Drive metadata. Do not select backup/sync categories unless the implementation actually backs up or syncs files.

For final questionnaire style answers:

```text
Personal use only: No
Internal use only: No
Development/testing/staging only: No
WordPress Gmail SMTP plugin only: No
```

Acknowledge CASA/security assessment if requesting restricted scopes such as Gmail readonly.

## Additional-info text pattern

```text
Revenue Recovery Desk is a business-to-business revenue recovery workflow for companies that explicitly onboard and connect their own Google Workspace account. Google data is used only for overdue invoice recovery context. Gmail read-only access helps detect customer replies, disputes, payment confirmations, stop/contact requests, and thread history before any follow-up is drafted. Drive metadata read-only access helps locate relevant invoice folders, SOPs, payment records, and recovery templates by file/folder metadata only. The app does not send email through Gmail, modify Gmail or Drive data, download Drive files, sync Drive contents, or back up user data. Recovery outreach is human-reviewed and approval-gated.
```

## Demo video production notes

The demo should be compliance-friendly, not salesy. Show:

1. The official FlowAudit Revenue Recovery page.
2. User-initiated onboarding / integration connection.
3. The Google consent screen or a faithful explanatory slide with exact requested scopes.
4. Post-auth connected state / controls.
5. Privacy and disconnect/offboard controls.

When the operator asks for voiceover, prefer the user's ElevenLabs **Kofi PVC / Kofi Professional Clone** voice when available. Never paste ElevenLabs keys in chat; use a local-only installer or existing env value.

A proven lightweight build path is:

- Use Playwright/Chromium to capture 1920x1080 frames from the official page and locally generated explanatory slides.
- Generate ElevenLabs narration from a concise script.
- Assemble frames + audio with ffmpeg into an H.264/AAC MP4.
- Verify with ffprobe: duration, video dimensions, codec, and audio stream.

Keep the final artifact short enough for app verification review (about 1–2 minutes) and avoid exposing secrets, live tokens, client data, or internal dashboards.
