# Setting up Mail

You're helping the owner connect Mail to their Gmail, read-only. Do this in
the conversation with them:

1. Ask which Gmail address to use.
2. Explain they need a Gmail **app password**
   (https://myaccount.google.com/apppasswords, requires 2-Step Verification;
   Google Workspace accounts need their admin to allow it). It lets the box
   read mail over IMAP; Mail never sends, deletes, or changes anything.
3. Have them save it on the box themselves so it never passes through the
   conversation. Give them this to run in Springroll's terminal (a Shell
   session) or over SSH:

       read -rp "Gmail address: " a; read -rsp "App password: " p; echo; printf "%s\n%s\n" "$a" "${p// /}" > ~/.config/springroll/gmail; chmod 600 ~/.config/springroll/gmail; echo saved

4. When `~/.config/springroll/gmail` exists, test the login without printing the
   password: `python3 -c "import imaplib; a,p=open('$HOME/.config/springroll/gmail').read().split(); m=imaplib.IMAP4_SSL('imap.gmail.com'); m.login(a,p); print('ok')"`.
   If it fails, say why (wrong address, 2-Step not on, Workspace blocks app
   passwords) and help fix it.
5. Run the first sync: `systemctl --user start mail-sync` (a few minutes for
   30 days), check `journalctl --user -u mail-sync -n 20`, then `show mail`.
6. Remove `views/mail/.setup-pending`, commit, and tell the owner it's ready.
