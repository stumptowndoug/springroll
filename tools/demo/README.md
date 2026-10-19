# Demo machine

A throwaway Springroll filled with a made-up week, for screenshots and showing people. It runs in
a systemd container on a machine with Docker, installed from this checkout the way a new machine
is, so the screenshots are of the real thing and of nobody's real data.

    CLAUDE_TOKEN_FILE=~/.config/springroll/claude-token tools/demo/up.sh   # build it (~5 min)
    tools/demo/shots.sh shots/        # 2x screenshots: desktop and phone, dark and light
    tools/demo/up.sh down             # throw it away

- `seed.sh` (runs inside): settings (Inter, Springroll Glass, Pacific time), five command jobs
  that publish the reports in `reports/` and are moved back across the week, Timeline items, a
  to-do list. Edit the reports and signals there to change what the screenshots say.
- With a Claude token, one real chat builds a Reading list app, so the chat and the app in the
  screenshots are real work. Needs you is ranked by a model, so it only reads well signed in.
- On a Springroll machine, `preview 8180` opens the demo in a browser.
