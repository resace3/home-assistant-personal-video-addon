# Changelog

## 0.2.3

- Correct the tag release linter path and retain strict failure for patchable
  High and Critical container vulnerabilities.

## 0.2.2

- Install FFmpeg in the release validator before creating browser-test media.

## 0.2.1

- Fix tag-gated browser release validation so the prebuilt image can be published safely.

## 0.2.0

- Add actionable catalog diagnostics for missing `/share` mounts, missing or invalid indexes, and unavailable media bundles.
- Validate the runner's schema-v1 timestamps and period metadata while retaining only safe, complete catalog entries.
- Tighten single-range parsing and prevent empty or non-regular assets from being advertised.
- Keep all browser requests relative to the randomized Ingress base path and improve autoplay, reduced-motion, accessibility, and responsive settings behavior.
- Publish a pinned multi-architecture image with a security-upgraded Debian base.

## 0.1.2

- Use Home Assistant Supervisor's standard add-on confinement instead of an incomplete custom AppArmor profile that blocked the base init system.

## 0.1.1

- Allow the Home Assistant base image init process under the custom AppArmor profile.

## 0.1.0

- Initial admin-only Ingress viewer with read-only share mount, ID-based catalog, descriptor-safe file access, full single-range streaming, responsive feed/dashboard, daily and weekly libraries, local preferences, captions, accessibility, and security headers.
