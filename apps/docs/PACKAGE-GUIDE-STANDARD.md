# Package guide completion standard

The official website is an English explanation of Fluo's packages and their
composition, not a generated API inventory or a web copy of the Book.
The existing Dependency injection chapter is the depth benchmark, not a word
count target. A short index table plus repository links is not a complete guide.

## Reader outcomes

Each public package needs one canonical guide which lets the reader:

1. Explain the problem it solves, its responsibility and when not to use it.
2. Install the required packages and peers for an explicitly supported host.
3. Register or construct it through the current canonical public API.
4. Run a meaningful small example with its prerequisites and expected output.
5. Understand how the example works, rather than merely copy unexplained code.
6. Compose it with its real neighboring packages and understand ownership.
7. Predict defaults, startup/shutdown, errors, partial success and limitations.
8. Test at the relevant seam and diagnose concrete common failures.

Not all packages are modules. Do not invent `forRootAsync`, static factories,
parameter decorators or configuration options to make every chapter look alike.
Read the owning README, exports, implementation and tests before making claims.
Keep recommended usage canonical; label migration/advanced variants explicitly.

## Format and ownership

- Frontmatter includes `title`, `description`, and a machine-consumed `package`
  value such as `"@fluojs/redis"`. One guide per public package.
- Guides live at `packages/<package-suffix>.mdx`; Socket.IO uses `socket-io.mdx`.
  DI keeps its existing canonical `fundamentals/dependency-injection.mdx`.
- Internal export paths are not supported user entry points. Explain meaningful
  public subpaths and their runtime boundaries without enumerating internals.
- Use `/docs/...` links only. Preserve existing beginner paths and governed
  source snippets. Do not import Books or publish a separate reference corpus.
- Complete examples name installation, files, registration and execution.
  Fragments explicitly name the preceding setup and enclosing class/function.
- Avoid copied snippets drifting from tests. Where feasible, test source files
  directly and expose them through the site's source-backed code component.
- Do not add tests that pin prose, word counts or headings. Machine package IDs,
  file references, public imports, rendered source equality and runtime outcomes
  are appropriate verification targets.

## Evidence

Each owning workstream records actual source/contract paths, verified commands
and results, required external services, and anything not executed. A source
alias test is not proof of published-package compatibility; a mock is not proof
of native rollback, durable delivery or platform behavior.

Typecheck representative complete examples. Exercise at least one meaningful
composition per package family. Use actual native listeners/databases where the
claim depends on them and the fixture infrastructure supports it. No fixed
sleeps in asynchronous tests; subscribe before triggering and bound the wait.

Keep changes to documentation and its own fixtures unless an independently
authorized behavior change is required. Report disagreements between contracts
and implementation; never lower a documented guarantee to conceal a defect.

## Publication gate

Complete manifest coverage, machine reference integrity, relevant fixture
tests, a production docs build, internal links/search, and rendered desktop/
mobile review are required. Automated coverage checks establish presence and
traceability, not the explanatory quality established through editorial review.
Public deployment remains a separate authorized side effect.
