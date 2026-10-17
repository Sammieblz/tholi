# Shared presentation

`packages/ui` owns presentation contracts, Guide/Conversation, attention, composer, route nodes, Wayfinder and responsive widget priority. It receives state and callbacks from the extension controller or isolated website practice adapter. It cannot call Chrome, grant permissions, read credentials or assert completion.

Keep one shared implementation for matching behavior. Shared tokens and easing live in the package; website storytelling and privileged extension settings remain application-owned. Outcome, continuity and safety rules remain outside presentation.

See [frontend architecture](README.md) for detailed ownership, interaction and motion constraints.
