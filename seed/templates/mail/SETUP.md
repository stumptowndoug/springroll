# Setting up Mail

You're helping the owner connect Mail to their Gmail, read-only. Do this in
the conversation with them:

1. Send them to **Connections → Gmail** (`show '#/connections/gmail'`). For each account they
   add the address and an **app password** (https://myaccount.google.com/apppasswords; needs
   2-Step Verification). Springroll tests it before saving. Never ask for the password in chat.
2. If an account can't make app passwords (some Workspace accounts), the same sheet has
   **Sign in with Google**: it needs their own Google Cloud OAuth client once. Walk them through
   the steps shown there (project, Gmail API, consent screen published, Web client with the
   redirect URI it shows, then paste the client ID and secret into that sheet).
3. When at least one account shows "Working", run the first sync:
   `systemctl --user start mail-sync` (a few minutes for 30 days), check
   `journalctl --user -u mail-sync -n 20`, then `show mail`.
4. Remove `views/mail/.setup-pending`, commit, and tell the owner it's ready.
