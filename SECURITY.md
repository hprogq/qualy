# Security policy

## Reporting a vulnerability

Please report security problems privately, through GitHub's private
vulnerability reporting:
[Report a vulnerability](https://github.com/hprogq/qualy/security/advisories/new)
(the **Security** tab of this repository). Do not open a public issue, pull
request or discussion for a suspected vulnerability.

A useful report says what an attacker can do, against which version or commit,
and how to reproduce it. You will get an answer within a few days. Fixes are
released first and disclosed after, with credit if you want it.

## Scope

- The code in this repository, on its `main` branch.
- The deployment at `https://qualy.hprogq.com`. It serves demonstration data
  only; there are no real students' records on it.

When testing the deployment, please do not:

- run load or denial-of-service tests, or automated scanners at high rates;
- try to reach or change data of accounts other than one you control;
- attack the hosting provider, the email provider or other people.

## What is not a vulnerability here

- The source being public. The design assumes an attacker has read it.
- Identifiers that are public by design: the RUM reporting id, bucket names,
  image digests and release ids.
