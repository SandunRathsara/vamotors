# Evidence index

| Task | Revision | Artifact | Classification |
| --- | --- | --- | --- |
| T00 | `8203d2a1dbd9b98c13d3188abf53286f393d98c7` | [Preservation](T00-preservation.md) | Author inventory, original byte hashes, staging boundary |
| T00 | same preservation revision | [Current checks](T00-checks.md) | Fresh local author results, explicit failures/omissions |
| T00 | final documentation commit containing this index | [Traceability validation](T00-validation.md) | Author exact-set/byte checks; independently reproduce and review scenario quality |
| Readiness | T00 candidate `f51b1648bbbda5fb8e37129ba31be0683d63678f`; recording on separate branch | [Attributed readiness](T00-readiness-attributed.md) | Supplied independent reviewer report; not reproduced by ledger worker, not acceptance |
| T00 acceptance | `f51b1648bbbda5fb8e37129ba31be0683d63678f` | [Attributed acceptance and dispatches](T00-acceptance-attributed.md) | Independent reviewer PASS and orchestrator acceptance; execution exception disclosed; no feature acceptance |

The accepted T00 revision is `f51b1648bbbda5fb8e37129ba31be0683d63678f`; later documentation commits do not replace that binding. Acceptance above is attributed to the independent reviewer and orchestrator, not reproduced by this ledger worker and not feature acceptance. Reviewer evidence must name exact reviewed commit, commands, outcomes and findings. Add later hosted/recovery evidence here only after execution; never attach secrets, browser auth state, signed URLs or secret-bearing traces.
