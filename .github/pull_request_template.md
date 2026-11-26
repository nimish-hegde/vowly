## User problem and linked issue

Closes #

## PM acceptance criteria & what changed

- **Measurable acceptance criteria:**
- **What changed and why:** Describe the decision and its effect on the couple’s workflow.

## Verification & evidence

- [ ] Offline checks pass (`npm test`, `npm run eval -- --provider mock`, `cd frontend && npm test && npm run lint && npm run build`)
- [ ] Financial safeguards verified (AI extracts facts only; deterministic calculation parity; unresolved mandatory charges block approval/booking; drafts isolated; deposits unpaid by default)
- [ ] Live AI evaluations run and reported **separately from mock results** (exact model version, dataset version, accuracy, 0 critical financial errors, latency, retries, token usage, estimated cost) *(if extraction changed)*
- [ ] Browser-based E2E UAT completed (pricing/inclusions/missing info/payment comprehension, manual correction count, time to vendor comparison) *(if UI changed)*
- [ ] Independent code review addressed and secret/privacy check passed (0 keys or personal wedding data committed)

Include screenshots, demo notes, or remaining failure cases below:

## Documentation & release gate

- [ ] Updated `docs/ROADMAP.md` (milestone status / decision log), `docs/EVAL_REPORT.md`, `CHANGELOG.md`, `docs/PRODUCT_SPEC.md`, or `README.md` as applicable
- [ ] **Hold for explicit PM approval before merging**
