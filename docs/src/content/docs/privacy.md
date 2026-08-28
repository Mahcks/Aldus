---
title: Privacy policy
description: How Aldus handles data in self-hosted installations, the public demo, and support.
---

_Last updated: August 26, 2026_

Aldus is a client for privately operated media servers. Who handles your data depends on whether you connect to a self-hosted server, use the developer-operated public demo, or contact Aldus support.

## Self-hosted servers

The person or organization running an Aldus server controls the accounts, media, and activity on that server. Their server may store:

- Account details, authentication sessions, and reader-device credentials
- Library memberships, collections, preferences, and activity
- Ebook and audiobook files, metadata, acquisition requests, and source configuration
- Reading and listening progress, including synchronization data
- Operational request logs containing a request identifier, method, path, response status, duration, byte count, and network address

This information is used to authenticate users and provide the server's library, playback, reading, synchronization, administration, and security features. The Aldus developer does not receive it merely because you use the app. Ask your server operator about their hosting providers, access controls, backups, log retention, and deletion practices.

### Data stored on your device

The Aldus app stores authentication credentials in the device's secure credential storage. Other app storage and the device filesystem may hold:

- The server address and remembered account metadata
- Cached catalog and library metadata
- Preferences and interface state
- Downloaded ebook and audiobook files and their metadata
- Reading or listening progress waiting to synchronize

This data supports sign-in, offline use, and synchronization. It remains on the device until the app removes it, you clear the app's data, or you uninstall the app, subject to the device platform's own backup and deletion behavior.

## Public demo

The public demo is operated by the Aldus developer. It creates a randomly named guest account without asking for an email address or password. The demo processes the guest identifier, library membership, collections, reading and listening progress, and activity needed to provide the service. Demo media is public-domain demonstration content.

Guest access expires 24 hours after creation. Expired guest records and their personal activity are removed during automated cleanup, which may occur after access has expired rather than at the exact 24-hour mark. Shared acquisition history that must remain for server integrity is kept without the requesting account attached.

Demo operational request logs may contain a request identifier, method, path, response status, duration, byte count, and network address. These logs are used to operate, troubleshoot, and protect the shared service. Aldus does not export them to a separate log service; Fly.io's managed searchable logs are [currently retained for about seven days](https://fly.io/docs/monitoring/search-logs/).

Do not upload personal media or use the demo to store information you need to keep.

## Support correspondence

If you contact us, we process your email address, message, attachments, and any technical details you choose to provide so we can respond and investigate the issue. Email providers used to deliver and store correspondence process that information as part of providing mail service.

Ordinary support correspondence is retained for 12 months after the last reply. Diagnostic information voluntarily shared for a support case is retained for 30 days after the case closes. Security reports are retained as long as needed to investigate, remediate, and document their resolution.

Do not send passwords, session tokens, API keys, complete server addresses, private media, or private library details. See [Support](/support/) for safer reporting guidance.

## Analytics, advertising, and third parties

The current Aldus app does not include third-party analytics, advertising, cross-app tracking, or automatic telemetry sent to the Aldus developer. Aldus does not sell personal information.

Your device platform, App Store, network provider, self-hosted server operator, and any hosting or email services they use may process information under their own policies. Apple may separately offer optional App Analytics or crash information to developers; that collection is controlled by Apple and your Apple privacy settings.

## Account deletion

Guest and regular accounts can be deleted from **Account → Delete account**. An administrator can also delete their own account unless it is the last enabled administrator, in which case another administrator must be created first.

Deletion removes the account, sessions, reader credentials, memberships, collections, preferences, and personal reading activity from that server. Shared acquisition history needed by other users remains without the requesting account attached. The app also removes offline media, credentials, remembered-user data, and pending progress associated with that account from the device used to delete it.

Deleting an account cannot remove files already stored on another device. Clear Aldus data or uninstall the app on other devices that were signed into the deleted account. A self-hosted operator may also retain backups according to their own backup schedule.

For help with deletion on a self-hosted server, contact its operator. For the public demo or a privacy question directed to the Aldus developer, email [privacy@aldus.media](mailto:privacy@aldus.media).

## Policy changes

This policy may change when Aldus features or data practices change. The updated policy will be published here with a revised date. Material changes will be described plainly before they take effect where practical.

## Contact

- Privacy and deletion: [privacy@aldus.media](mailto:privacy@aldus.media)
- General support: [support@aldus.media](mailto:support@aldus.media)
- Security reports: [security@aldus.media](mailto:security@aldus.media)
