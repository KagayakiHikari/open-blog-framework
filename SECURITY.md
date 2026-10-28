# Security policy

## One-time release; no maintenance commitment

This project has a single release version, 1.0.0. There is no commitment to periodic updates, long-term support, issue-response deadlines or future security patches. No actively maintained release line is promised. Operators must track vulnerabilities, maintain their own installation or fork, and discontinue public service if they cannot keep it safe.

Runtime compatibility floors are Node24.22.1 within 24.x and Node26.12.1 within 26.x. These are not ongoing support promises and do not prove every future version was tested. Windows, local Linux and hosted CI results must be recorded separately.

## No vulnerability reporting service

This one-time demonstration project does not offer a vulnerability reporting channel, private reporting service, monitoring or response commitment. Operators are responsible for investigating and fixing problems in their own deployment or fork. Do not disclose credentials, private logs, user data or sensitive exploit details in public issues or discussions.

No GitHub private reporting form or contact is claimed to be enabled. Keep sensitive evidence in your own private storage. The absence of a reporting service does not indicate that the project is free of vulnerabilities.

## Safe validation

Use a fixed candidate and isolated synthetic data. Never test another operator's service without authorization. Document affected versions, impact and a minimal synthetic reproduction privately when assessing your own deployment.

Review source, history, dependencies and artifacts. Tests or a registry audit are not a complete security guarantee. Backups contain secrets and may restore old credentials or sessions: revoke restored sessions and verify credentials before admitting traffic. Keep evidence, backups and real configuration outside distributions.

The project license is MIT; see LICENSE. This security policy does not authorize upload, deployment or release.
