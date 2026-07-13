---
status: accepted
---

# Separate hosted and desktop security profiles

Hosted multi-user Wordflow uses same-site HttpOnly Sessions with server-side
revocation, CSRF proof, and exact Origin validation. Packaged desktop Wordflow
is single-user and uses process identity plus process-scoped CSRF on loopback.
Bearer tokens and cross-site multi-user desktop exceptions are rejected because
they would weaken one profile to imitate the other; future cross-site desktop
support requires an explicit same-origin bridge and packaged-WebView tests.
