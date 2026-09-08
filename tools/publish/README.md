# Artifact generator

Turns `research.md` into `leaving-shopify.html`, the published Artifact.

```bash
python3 tools/publish/md2html.py && python3 tools/publish/build.py
```

`md2html.py` is a purpose-built converter for the markdown subset the document uses —
headings, tables, fenced code, lists, blockquotes, inline formatting — because no
converter was installed on the machine and pulling one in for this was not worth it.
`build.py` wraps the output in the page shell: design tokens, the three-state theme
palette, the sticky contents rail and the masthead.

**Why this lives here.** It was originally written in a session scratchpad under `/private/tmp`,
which is ephemeral — `research.md` would have survived and the thing that renders it would
not. Anything that regenerates a deliverable belongs in the repo.

Edit `build.py` for design changes (palette, type, layout, masthead figures) and
`md2html.py` for markdown features. Neither reads anything outside the project.
