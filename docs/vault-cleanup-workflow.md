# Vault cleanup workflow

Use this for Phase 4 / cleanup work around stale vault drops and noisy special-form rows.

## Command

```bash
/Users/AIAgenterminal/rrd-vault-cleanup --dry-run
```

Safe execute mode:

```bash
/Users/AIAgenterminal/rrd-vault-cleanup --execute
```

Optional special-form cleanup:

```bash
/Users/AIAgenterminal/rrd-vault-cleanup --execute --delete-special-forms --form-older-than-days 14
```

## Safety model

The cleanup workflow must be conservative:

- dry-run unless `--execute` is explicitly passed;
- never decrypt, print, or transform secret values;
- never touch profile `.env` files;
- never touch OAuth token values;
- never touch vault private keys;
- mark only truly expired `pending` drops as `expired`;
- report stale `deposited` drops for human review instead of deleting them;
- keep old `consumed` drops as audit-only unless a separate retention policy is explicitly implemented;
- only delete SOP/readiness/mapping special-form rows when `--delete-special-forms` is explicitly supplied.

## Why this exists

The vault can accumulate:

- expired pending links;
- old deposited drops that still need approval/reissue decisions;
- consumed audit rows;
- form-response rows (`SOP_REVIEW_WEB`, `READINESS_DETAILS_WEB`, `MAPPING_DETAILS_WEB`) that should not be treated as onboarded businesses.

Cleanup should reduce operator noise without destroying installed credentials or client access history.

## Reporting rules

Report only:

- drop id;
- profile;
- company;
- kind/provider;
- status;
- timestamps;
- env key count;
- whether ciphertext exists.

Never print env key values or ciphertext.
