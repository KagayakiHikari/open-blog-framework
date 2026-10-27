# Contributing

The project uses the MIT License; see LICENSE. Keep the applicable third-party notices. This candidate remains under local review; license selection does not authorize uploading or publishing this repository.

This is a one-time release with frozen features. There is no commitment to accept pull requests, provide regular updates or deliver future security patches. Forks remain the responsibility of their own maintainers; these validation instructions are not a maintenance promise.

Use a clean checkout, a dedicated data directory and synthetic content. Run `npm ci --ignore-scripts`, `npm run check`, `npm test`, `npm run build`, `npm run scan`, `npm run licenses` and an official-registry dependency audit. Build refuses an existing dist directory; use another clean checkout for a new candidate.

Do not add real configuration, original-site resources, credentials, personal information, telemetry, logs, databases or copied proprietary code. A `.gitignore` rule is not permission to place private materials inside the repository. Never add private source archives as test fixtures.

Keep application policy in the content/security layers, use bound SQL parameters, escape template values and sanitize generated Markdown HTML. Preserve ownership and publication predicates. New migrations must be forward-only numbered files with an upgrade/backup plan. Add tests for meaningful permission, input and failure boundaries.

Keep dependencies exact, preserve the lockfile, justify new packages, review licenses and avoid install scripts. Native dependencies require component-level review as well as npm metadata. Trusted extensions are code execution and need explicit review.

Any proposed release-blocking correction must describe the problem, validation actually run and outstanding limitations. Never claim an unexecuted check passed. Publication, deployment and production tests require the operator's separate authorization.
