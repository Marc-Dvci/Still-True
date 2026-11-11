# Security

Please report a vulnerability through
[GitHub's private reporting](https://github.com/Marc-Dvci/Still-True/security/advisories/new), not in a
public issue. The supported version is the `main` branch and the
[live deployment](https://still-true.chatisthisreal.workers.dev).

The reports that matter most are anything that:

- reads or reuses another account's Buffer tokens, or a session cookie it did not receive;
- makes Still True change a post in Buffer without the owner's settings or action;
- makes the page fetcher reach an address it should not (it accepts public http and https hosts only);
- changes an entry of an account's action log without the check noticing.
