# ClassroomPath FAQ For IT Objections

> Status: maintained
> Applies to: technical decision-makers and school IT teams
> Last verified: 2026-04-13
> Source of truth: `docs/evaluation/faq-it-objections.md`

## "How do we know this is not a black box?"

The core technology is published separately and the wrapper boundary is documented.

See:

- [OpenPath repository](https://github.com/balejosg/openpath)
- [`claims-and-evidence.md`](claims-and-evidence.md)

## "Where is the security boundary documented?"

The current session and browser boundary is documented in [`../SESSION_SECURITY_MODEL.md`](../SESSION_SECURITY_MODEL.md), including cookie storage, origin checks, logout behavior, and residual constraints.

## "What if a pilot creates more support work than expected?"

That is exactly why the pilot should stay limited and measured. Use [`pilot-runbook.md`](pilot-runbook.md) to define scope, ownership, and exit criteria before expanding.

## "Can we evaluate this without assuming compliance claims?"

Yes. The current evaluation package explicitly separates documented facts from claims the repository does not make.

See:

- [`security-trust.md`](security-trust.md)
- [`claims-and-evidence.md`](claims-and-evidence.md)

## "How do we know whether the product fits our estate?"

Start with [`compatibility-matrix.md`](compatibility-matrix.md) and then confirm rollout scope during the pilot design.

## "What if we need self-hosting instead?"

That is a separate decision path. Review [`openpath-vs-classroompath.md`](openpath-vs-classroompath.md) and then the OpenPath OSS documentation if self-operation is the real target.
