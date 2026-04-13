# OpenPath vs. ClassroomPath

> Status: maintained
> Applies to: buyer and evaluator routing
> Last verified: 2026-04-13
> Source of truth: `docs/evaluation/openpath-vs-classroompath.md`

OpenPath and ClassroomPath are related, but they are not the same offer.

## Comparison

| Topic                   | OpenPath                                                                      | ClassroomPath                                                              |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Role                    | Auditable OSS core                                                            | Managed service built on top of OpenPath                                   |
| Primary audience        | Technical teams that want to operate or customize the core                    | Schools that want a managed path to rollout, pilot, and production use     |
| Operated by             | Your team                                                                     | ClassroomPath service operation                                            |
| What you evaluate first | API, admin UI, endpoint agents, browser integration, license fit              | Security boundary, onboarding flow, delegated administration, rollout path |
| Licensing               | `AGPL-3.0-or-later`                                                           | ClassroomPath Source-Available License 1.0                                 |
| Best fit when           | You want self-hosting, direct customization, or deeper infrastructure control | You want lower operational overhead and a buyer-oriented evaluation route  |

## Practical Rule

Start with **OpenPath** if your first question is:

- "Can our team inspect and operate the core ourselves?"
- "Do we need to modify the product under an OSS license?"

Start with **ClassroomPath** if your first question is:

- "Can we pilot this without building another internal operations project?"
- "Can leadership, IT, and operations evaluate the service with one shared path?"

## Linked Evaluation Material

- OpenPath OSS adoption path: [`balejosg/openpath/docs/evaluation/adoption-path.md`](https://github.com/balejosg/openpath/blob/main/docs/evaluation/adoption-path.md)
- ClassroomPath security and trust guide: [`security-trust.md`](security-trust.md)
- ClassroomPath IT evaluation checklist: [`it-evaluation-checklist.md`](it-evaluation-checklist.md)
- Demo, pilot, and pricing route: [classroompath.eu](https://classroompath.eu/)
