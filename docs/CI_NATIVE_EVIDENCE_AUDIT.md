# Native CI evidence audit and cross-org runner governance

## Native acceptance receipts

The combined native gate must validate individual compiler file outcomes,
not merely an aggregate success count. The evidence helper verifies every
OresMain --check receipt for success, zero exit, null signal, ordered file
manifest, a SHA-256 matching the actual source bytes, and exact compiler HEAD.
It independently checks the guest receipt for real execution, byte-exact
stdout, exact compiler identity, and fixture/oracle hashes.

Run the Node evidence test and complete existing suite in a trusted source
checkout. Local Node tests exercise the evidence validator only: they do
not establish native Oreslang syntax, actor behavior, or crash recovery.
An executed native verdict requires a clean ephemeral compiler build,
provenance for compiled classes/dependencies, and nonzero CI job steps.

## Runner-admission results versus test verdicts

Jobs with zero recorded steps are infrastructure/admission failures. Report
their run IDs and step count, and do not label them source-test failures.
A different organization with successfully executed Actions jobs indicates
recent runner capacity only; it does not guarantee billing minutes or
trusted/private build suitability.

## Private source transfer gate

Do not push Git blobs, trees, packfiles, compiler source, generated mirror
branches, or equivalent private code into another organization until BOTH
the source owner has approved that exact transfer and the destination owner
has authorized the runner/repository and retention policy. Review open
security incidents and source/destination protection first. A source-free
canary may be used to validate runner steps and a fail-closed CI contract,
but must contain no private source or proprietary build artifacts.

When separately approved, verify source/tree SHA identity, destination
privacy, credential scopes, workflow provenance, execution steps, and
post-run deletion evidence. Do not inject cross-org checkout tokens, bypass
required reviews, or treat a GITHUB_TOKEN as private cross-org authority.

## Known limitations

The Node helper validates receipts and local source bytes, not that a
compiler binary truly came from the pinned Git commit. It is not an
independent security principal or a cryptographic attestation. Static
contract tests do not imply guest execution, workflow durability or
backend parity. A production process requires separate trusted build
evidence and review.
