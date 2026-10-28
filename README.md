# Open Blog Framework

English | [简体中文](README.zh-CN.md)

A lightweight blog framework built with Node.js and SQLite. This personal open-source demonstration project is intended as a reference for learning, building a personal blog, and further development.

Its server-rendered architecture provides article management, Markdown editing, tags and search, an archive timeline, media management, administration with role-based permissions, a responsive theme, and basic SEO. The project focuses on a simple architecture, independent deployment, and customizable presentation.

## Project status

Only one public release, **v1.0.0**, is planned. It has not been published yet. Features are frozen, with no further iteration, long-term maintenance, feature updates, regular security patches, or issue-response deadlines promised.

You may fork, modify, and redistribute the project under its license. Operators are responsible for tracking runtime, dependency, and application vulnerabilities and maintaining their own deployment or fork. Discontinue public service if you cannot keep it safe.

The project offers no vulnerability reporting channel, monitoring, response, or remediation service. Do not disclose credentials, private logs, user data, or sensitive exploit details in public issues or discussions. See [SECURITY.md](SECURITY.md).

## Architecture

- Node.js ESM and the native HTTP server.
- A local SQLite database accessed through `node:sqlite`.
- Server-rendered HTML with native JavaScript and CSS.
- `marked` and `sanitize-html` for Markdown; Sharp for image processing. Exact versions are recorded in the lockfile.

The application does not require an external database, CDN, font service, or private service API at runtime.

## Features

- Article creation, editing, deletion, drafts, scheduled publication, and revision-conflict detection.
- Markdown, tables, HTML sanitization, local images, summaries, tags, and paginated search.
- An `/archives` timeline with UTC year filtering, up to 30 articles per page, native disclosure controls, and mobile layouts.
- Administrator and editor permissions, a backend editor, media library, session revocation, and audit records.
- Image validation and re-encoding in isolated child processes, with upload and processing concurrency limits.
- RSS, sitemap, robots directives, canonical URLs, and descriptions.
- Floating glass navigation, an article gallery, light and dark themes, responsive layouts, and configurable site identity.

## Limitations

Only one web process is supported. SQLite and LIKE-based search are intended for small sites; clustering is not supported. Credential changes made by the CLI and web server are coordinated through SQLite transactions, which does not imply support for multiple web instances.

There is no music page or player, comments, public registration, separate category tree, ZIP import, remote image fetching, or online plugin marketplace. Future development is not promised. The existing code-level extension interface runs trusted code; it is not a sandbox. Media URLs are public, including images referenced by drafts.

## Quick start

Use your own dedicated directory. The supported runtime floors are **Node.js 24.22.1 or later within 24.x**, or **26.12.1 or later within 26.x**. These are compatibility and security baselines, not ongoing support promises or proof that every future version has been tested.

~~~sh
npm ci --ignore-scripts
npm run migrate
~~~

Keep optional packages enabled: Sharp requires platform-specific prebuilt dependencies. Initialization does not create a default account, password, or example articles, and does not import existing data.

Create an administrator with a fresh, unique password of 16–256 bytes, supplied through standard input. Do not put passwords in command arguments, exported environment variables, or Git. In Bash:

~~~bash
read -rs -p 'New unique passphrase: ' BLOG_INPUT; printf '\n'
printf '%s' "$BLOG_INPUT" | npm run admin -- create operator admin
unset BLOG_INPUT
npm start
~~~

A silent-input PowerShell example is available in the [installation guide](docs/INSTALL.md). `operator` is an example username and is not created automatically. Open the [local blog](http://localhost:4300); the administration login is at `/login`.

Data is stored in the dedicated `var/` directory by default. If you copy `.env.example` to a local `.env`, load it explicitly and use the same configuration for migrations, account commands, and the server:

~~~sh
node --env-file=.env scripts/migrate.js
node --env-file=.env src/server.js
~~~

For account commands, use the same `node --env-file=.env scripts/admin.js` prefix and continue to pipe passwords through standard input. The application does not load `.env` implicitly.

## Theme and archives

Configure the logo, favicon, background, homepage text, profile, navigation, footer, colors, and fonts in `design.json`. The site name and description use environment variables. Theme options are `light`, `dark`, and `system`, with `paper` and `night` aliases. Default assets are local SVG files; icons include third-party notices.

Archives display public articles from the independent database in matching glass panels. The year form and native disclosure controls do not require JavaScript to generate their content. Browser acceptance testing with JavaScript completely disabled must be recorded separately.

## Secure deployment and recovery

1. Use your own accounts, data, domain, and proxy. Production mode requires your own HTTPS origin. The application binds to a loopback address; do not expose the development HTTP server directly.
2. Use a low-privilege service account, read-only application source, and a dedicated writable data directory. Apply operating-system CPU, memory, disk, and file-permission or NTFS ACL limits.
3. Have the proxy preserve the configured Host. The application does not trust forwarded headers. Clients behind a proxy share the socket-peer quota, which may limit higher-traffic deployments.
4. Stop the web process and media tasks before backing up the complete data directory. Do not copy only the main SQLite file while it is running. Backups contain article content, password hashes, and sessions; store them privately and encrypt them through your own backup process.
5. Restore into an isolated directory and verify the database and media. Restoration rolls back credentials and revocation state. Before admitting traffic, use the account CLI to revoke sessions for every restored account, verify current credentials, and reset passwords when necessary.

See the [deployment and recovery guide](docs/DEPLOYMENT.md). Application tests do not replace validation of HTTPS, proxy configuration, OS permissions, backup storage, or disaster recovery. Operators remain responsible for ongoing operation.

## Verification and distribution

In a freshly installed, clean copy without an existing `dist/` directory, run:

~~~sh
npm ci --ignore-scripts
npm run verify:release
~~~

The workflow performs syntax checks, unit, integration and security regression tests, dependency auditing, file-by-file builds, scanning, and independent installation and startup verification. The runtime distribution uses an explicit file allowlist and SHA-256 manifest; it is not a minified bundle. It excludes Git, real environment configuration, databases, logs, dependencies, and generated test data. The complete source also includes CI definitions and synthetic tests.

CI defines Windows and Ubuntu jobs for two exact Node.js versions. A workflow definition does not prove that GitHub-hosted CI has run. Record local Windows, WSL Linux, and hosted-runner results separately. Passing tests or a clean npm audit is not a guarantee of safety.

Detailed guides below are currently in Simplified Chinese; the security policy and third-party notices are available in English.

- [Installation](docs/INSTALL.md) · [Deployment and recovery](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md) · [Design system](docs/DESIGN-SYSTEM.md) · [Archives](docs/ARCHIVES.md)
- [Security policy](SECURITY.md) · [Verification workflow](docs/AUDIT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) · [Assets](docs/ASSET-LICENSES.md) · [Dependency inventory](docs/dependency-inventory.json)

## License

This project uses the [MIT License](LICENSE), with **Copyright (c) 2026 KagayakiHikari**. Third-party icons and dependencies retain their own licenses and notices. This is still an unpublished candidate with `private: true`; selecting a license does not authorize public release.

All demonstration inputs are fictional. Validation and deployment guidance are retained. Publication still requires explicit approval from the maintainer.
