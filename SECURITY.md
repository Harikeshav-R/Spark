# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

---

## Reporting a Vulnerability

If you discover a security vulnerability within this repository, please do not file a public issue.

Please report vulnerabilities privately by contacting the project lead:
- **Email**: `r.harikeshav@gmail.com`
- **Subject**: `[SECURITY VULNERABILITY] Spark`

Please include:
1. Description of the vulnerability and its potential impact.
2. Steps to reproduce or proof-of-concept payload.
3. Affected components, endpoints, or file paths.

We will acknowledge receipt within 48 hours and coordinate remediation before public disclosure.

---

## Architectural Security Invariants

All contributors and automated agents must adhere to the core security gates:
- **Zero Secret Exposure (GATE 7)**: Never commit API keys, service role keys, or Zoom OAuth credentials into git.
- **Identity & Authorization (GATE 1 & 2)**: All server-side requests must authenticate via Supabase JWTs and verify course enrollment. Client-supplied user/role assertions are untrusted.
