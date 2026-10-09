# AgentOS

A Linux box you don't operate yourself. You talk to an agent; it builds the
small tools you need, runs things on a schedule, and shows you the results in
one window you can open from anywhere. The machine can be wiped and rebuilt,
because everything that matters lives in one repo.

- [The idea](docs/idea.md): why, the shape, the interface, risks, first steps
- [The server](docs/server.md): the Hetzner box this runs on
- [Packaging](docs/packaging.md): installing on any box (`seed/install.sh`)
- `seed/`: what gets installed; `seed/home/` becomes the machine's home repo
- [Visual sketch](https://claude.ai/artifact/1sBCnN8o76tWmBi7vrAsrW)

Separate from Springroll (`~/dev/springroll`), which is paused.
