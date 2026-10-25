# Evidence index

| Task | Revision | Artifact | Classification |
| --- | --- | --- | --- |
| T00 | `8203d2a1dbd9b98c13d3188abf53286f393d98c7` | [Preservation](T00-preservation.md) | Author inventory, original byte hashes, staging boundary |
| T00 | same preservation revision | [Current checks](T00-checks.md) | Fresh local author results, explicit failures/omissions |
| T00 | final documentation commit containing this index | [Traceability validation](T00-validation.md) | Author exact-set/byte checks; independently reproduce and review scenario quality |
| Readiness | T00 candidate `f51b1648bbbda5fb8e37129ba31be0683d63678f`; recording on separate branch | [Attributed readiness](T00-readiness-attributed.md) | Supplied independent reviewer report; not reproduced by ledger worker, not acceptance |
| T00 acceptance | `f51b1648bbbda5fb8e37129ba31be0683d63678f` | [Attributed acceptance and dispatches](T00-acceptance-attributed.md) | Independent reviewer PASS and orchestrator acceptance; execution exception disclosed; no feature acceptance |
| T02a | Accepted merge `3d9596e60eec2766f83a18d71809e0186dd7a43e`, tree equals approved `c42a05a`; PR #2 | [Review, historical candidate and acceptance addendum](T02a-review-integration.md) | Independent source and integrated PASS; both PR checks successful; bounded T02a accepted, not parent T02/features |
| Browser readiness | Source `9f9b79c79223b92cd17d24a2e0c8b8596bef5696`; candidate base `3d9596e60eec2766f83a18d71809e0186dd7a43e` | [Attributed independent verification and integration](browser-readiness-integration.md) / [unchanged author runbook](../../../docs/operations/browser-readiness.md) | Environment readiness accepted by orchestrator; source independent PASS; combined docs PR verification pending, no feature acceptance |
| T01 corrected rejection / current integration | Rejected `a0e5eee1426dd91bcc8890d82065d7bad6e4a4b2`; accepted integration `ec4cfb4c1a52c5112189e037b0a82fadffd1bae8` | [Attributed fresh FAIL and diagnostic handoff](T01-corrected-candidate-rejection.md) | Supersedes active status above: PR #3 merged, tree equals approved `33624fb`, browser environment-only accepted; T01/G0 rejected, 4 prior findings PASS / 3 FAIL, six semantic IDs blocked; sole focused correction worker running, 0/134 accepted |

The accepted T00 revision is `f51b1648bbbda5fb8e37129ba31be0683d63678f`; later documentation commits do not replace that binding. Acceptance above is attributed to the independent reviewer and orchestrator, not reproduced by this ledger worker and not feature acceptance. Reviewer evidence must name exact reviewed commit, commands, outcomes and findings. Add later hosted/recovery evidence here only after execution; never attach secrets, browser auth state, signed URLs or secret-bearing traces.
