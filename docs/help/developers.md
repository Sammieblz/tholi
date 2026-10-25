# For developers

You can use the published Tholi extension without an account or backend. If
you want to build from source, connect your own backend or contribute, the
repository maintains the technical instructions.

## Build and customize

- [Repository documentation](../README.md): the starting point for development.
- [Source installation and browser setup](../guides/getting-started.md): build,
  load and refresh a development extension.
- [Developer installation](https://tholi.io/download#developer-installation):
  available ZIPs, checksums and manual installation directions.

Manual Firefox development builds are temporary installations. The Firefox
Add-ons version uses normal store installation.

## Connect or understand the system

- [Private backend setup](../guides/backend.md): configuration, permissions and
  API references. A backend remains optional.
- [Architecture overview](../architecture/README.md): frontend, browser runtime
  and backend ownership.
- [Navigation architecture](../architecture/navigation.md) and
  [language processing](../architecture/natural-language.md): implementation details.
- [Technical diagnostics](../guides/troubleshooting.md): inspecting and reporting
  navigation problems safely.

The private backend is not a Tholi cloud account or synchronization service.
Check its data and permission requirements before enabling a connection.

## Contribute or report a problem

Read the [contribution guide](../../CONTRIBUTING.md) for local checks and pull
requests. Use the repository's issue tracker for development bugs, with a
sanitized description and reproducible steps.

For everyday usage questions, start with [Troubleshooting](troubleshooting.md)
or [Tholi Support](https://tholi.io/support).
