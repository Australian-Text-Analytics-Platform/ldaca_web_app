# Clean-environment testing for the macOS desktop app

_Research snapshot: 2026-07-24_

## Recommendation

The practical industry pattern is not one macOS equivalent of Hyper-V. It is a
small test pyramid:

1. Run package integrity and runtime probes on a fresh GitHub-hosted macOS
   runner for every release candidate.
2. Use a disposable Apple-silicon macOS VM, cloned from a sealed base image, for
   the end-user flow: download the DMG, open it in Finder, drag the app to
   `/Applications`, launch it, and exercise Data Loader.
3. Repeat the release smoke test on one physical Mac before publication.

For this repository, **Tart on an Apple-silicon development Mac is the simplest
next step**. It exposes Apple's Virtualization framework through a scriptable
CLI, supports graphical guests, published macOS images, OCI registries, Packer,
SSH, and disposable clones. Keep two base images:

- `consumer-clean`: a vanilla macOS installation with a normal non-developer
  user and no testing tools;
- `ui-automation`: Xcode plus the permissions and tooling needed by XCTest or
  Appium.

Clone, test, collect evidence, and delete the clone. Do not mutate either base
image during a test.

## Why this is the macOS analogue

Apple's built-in substrate is
[Virtualization.framework](https://developer.apple.com/documentation/virtualization).
It can install and run a graphical macOS guest on Apple silicon, and Apple's
sample demonstrates installation from an IPSW plus save and restore of VM
state. A VM emulates the same CPU architecture as its host, so an Apple-silicon
guest tests `arm64`; it does not replace an Intel test machine.
([Apple macOS VM sample](https://developer.apple.com/documentation/virtualization/running-macos-in-a-virtual-machine-on-apple-silicon),
[VZVirtualMachine](https://developer.apple.com/documentation/virtualization/vzvirtualmachine))

The current macOS Tahoe licence permits, subject to its terms, up to two
additional macOS instances on an Apple-branded Mac already running macOS for
development or testing. Commercial hosted use has separate conditions. This is
an operational constraint to review before scaling a private VM fleet, not
legal advice.
([macOS Tahoe 26 licence, sections 2B(iii) and 3](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf))

## Option comparison

| Option | Clean state and GUI | Automation and scale | Best use | Main trade-off |
| --- | --- | --- | --- | --- |
| Apple Virtualization.framework directly | Full graphical macOS VM, installable from an IPSW, with save and restore support | Requires building a management application or scripts | Custom platform tooling | Maximum control, maximum engineering work |
| [Tart](https://tart.run/) | Graphical Apple-silicon guests; clone published or private images, then discard the clone | CLI, SSH, OCI images, Packer, CI integrations, and Orchard orchestration | Individual developers and small-to-medium self-hosted CI | Apple silicon only; Fair Source licensing applies; current headless hosts need an unlocked login keychain |
| [Orka Desktop](https://docs.macstadium.com/orka/orka-desktop/welcome-to-orka-desktop-30) | Local GUI and clean IPSW installation, or pull an OCI VM image | Images can move into the Orka ecosystem | Polished local/manual testing with an Orka adoption path | Less compelling than Tart if the immediate priority is a small scriptable workflow |
| [GitHub-hosted macOS runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | Every non-single-CPU job receives a new VM; both `arm64` and Intel labels are available | Lowest operational burden and already fits this repository's CI | Repeatable unattended package checks | A fresh CI VM is not the same as a person downloading and opening a quarantined DMG in Finder |
| [Anka Build Cloud](https://veertu.com/anka-build/) or [MacStadium Orka](https://macstadium.com/orka) | Versioned VM templates provisioned on genuine Mac hardware | Controllers, registries, APIs, scheduling, and CI integrations for fleets | Enterprise private macOS clouds and high concurrency | Licence cost and infrastructure complexity are disproportionate for one or two release smoke tests |
| Physical Mac | Exact hardware, security prompts, Accessibility behaviour, and architecture | Slow to reset and expensive to scale | Final release acceptance and hardware-specific coverage | State drifts unless the machine is erased or tightly managed |

Tart's official quick start currently publishes vanilla, base, and Xcode images
for macOS 13 through 26, supports creation from IPSW, and documents SSH and
read-only host-directory mounts. Its Packer integration can build a pinned base
image reproducibly.
([Tart quick start](https://tart.run/quick-start/),
[Tart Packer integration](https://tart.run/integrations/packer/))

At larger scale, Anka's Registry versions and distributes VM templates while
its Controller provisions VMs across Mac nodes. Orka similarly provides
Kubernetes-native, ephemeral macOS VM orchestration. Those products solve fleet
management rather than improving the fidelity of one local clean-machine test.
([Anka Registry](https://docs.veertu.com/anka/anka-build-cloud/working-with-registry-and-api/),
[Anka Controller](https://docs.veertu.com/anka/anka-build-cloud/working-with-controller-and-api/),
[Orka overview](https://docs.macstadium.com/orka/orka-overview/orka-overview))

## Release-candidate protocol

Use the built artifact, not an app copied directly from the build tree:

1. Start a new clone of the pinned `consumer-clean` image.
2. Download the published DMG inside the guest through the normal user-facing
   channel. Do not remove `com.apple.quarantine`.
3. Open the DMG in Finder, drag the app to `/Applications`, and launch it as the
   normal user.
4. Confirm the expected first-launch Gatekeeper dialogue, app startup, default
   data-root behaviour, workspace creation, CSV preview, and creation of a
   Source Data Block.
5. Reboot and launch once more to cover persisted settings and backend startup.
6. Save screenshots and app/backend logs, then delete the clone.

Gatekeeper specifically evaluates software downloaded from outside the App
Store for identified-developer signing, notarization, and modification, and
asks for approval on first launch. Apple requires direct-distribution apps to
use Developer ID signing and notarization under default Gatekeeper settings.
The notary service supports DMGs, and its ticket can be stapled for offline
verification.
([Gatekeeper](https://support.apple.com/en-au/guide/security/sec5599b66df/web),
[Apple notarization workflow](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow))

This matters immediately because the current Tauri configuration uses
`"signingIdentity": "-"` in
[`tauri.conf.json`](../../frontend/src-tauri/tauri.conf.json). That is suitable
for local build testing, but it is not the Developer ID signature Apple
requires for a consumer Gatekeeper/notarization acceptance test. A clean VM is
still useful now for install and functional testing, but a successful
user-like Gatekeeper result only becomes a release gate after Developer ID
signing, notarization, and ticket stapling are implemented.

## UI automation

Apple recommends a test pyramid with many unit tests, fewer integration tests,
and a smaller number of UI tests; XCTest controls macOS UI through
XCUIAutomation.
([Apple testing guidance](https://developer.apple.com/documentation/xcode/testing))

For a Tauri app, either:

- add a small XCTest UI target that launches the installed bundle by identifier;
  or
- use [Appium's Mac2 driver](https://github.com/appium/appium-mac2-driver),
  which exposes XCTest through W3C WebDriver and can launch an installed app by
  bundle identifier or path.

Appium requires Xcode, Accessibility/automation permissions, and serial UI-test
execution. Those prerequisites contaminate a consumer-clean image, which is why
automation and final user-like acceptance should use separate VM templates.

## Suggested matrix for Wordflow

- Every pull request: existing unit/integration checks.
- Every macOS package: fresh GitHub `arm64` runner, DMG mount, signature
  integrity, runtime manifest, bundled backend health check, and app process
  startup.
- Every release candidate: disposable Tart `consumer-clean` VM on the newest
  supported macOS, with the manual Finder and Data Loader flow above.
- Before expanding supported systems: add the minimum supported macOS to the VM
  matrix.
- Only if an Intel or universal package is published: add
  `macos-*-intel` in GitHub Actions and one Intel acceptance machine. GitHub's
  runner catalogue currently exposes distinct Intel and Apple-silicon macOS
  images, so architecture should be explicit rather than inferred.
