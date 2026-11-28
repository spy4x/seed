# Cutting a recording

`deno task video:cut` turns a talking-head recording into the finished cut with nothing done by
hand: the long video, one Short, captions, a Kdenlive project and the drafts to publish it.
Everything runs on your machine; nothing is uploaded. The code is `infra/scripts/video-cut.ts`
(the steps) and `video-cut-lib.ts` (the pure logic).

```sh
deno task video:cut <recording> <slug> [--out <dir>] [--no-claude] [--denoise] [--min-silence 0.8]
```

- `<slug>` names the Kdenlive project; one plain name, no `/` or `..`.
- `--out` is the work and output folder. By default it is `cut/` next to the recording, so
  `~/recordings/<slug>/raw.mkv` gives `~/recordings/<slug>/cut/`.
- `--no-claude` stops after the brief (see "Without Claude").
- `--denoise` adds ffmpeg's `afftdn` noise filter before the audio is levelled. Off by default.
- `--min-silence` is the shortest pause, in seconds, that is cut (at least 0.3).

## What it needs

| Tool          | Install                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `ffmpeg`, `ffprobe` | `sudo dnf install ffmpeg` (Fedora) or `sudo apt install ffmpeg` (Debian, Ubuntu)           |
| `whisper-cli` | build [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and copy `build/bin/whisper-cli` to `~/.local/bin/` |
| a model       | `ggml-small.en.bin` in `~/.local/share/whisper.cpp/models/`, or any model path in `WHISPER_MODEL` |
| `claude`      | Claude Code, signed in with your subscription. Not needed with `--no-claude`                     |

A missing tool or model stops the command with its name and the line that installs it.

## The steps

Each step leaves files in the work folder, and a rerun picks up from them.

1. **Transcript.** ffmpeg extracts 16 kHz mono audio and whisper.cpp writes word times
   (`--output-json-full`), kept as `transcript.json`. Skipped when `transcript.json` exists.
2. **Silences.** A pause between words longer than `--min-silence` is cut, keeping 0.2 s of quiet
   on each side.
3. **Edit list.** `brief.md` is the transcript with numbered segments and what to return. With
   `edit-list.json` already in the folder, that list is used. Otherwise `claude -p` answers the
   brief (no API key: your Claude Code subscription), the raw reply is kept in `claude-reply.txt`,
   and the list is saved as `edit-list.json` only when it is valid. An invalid list stops the
   command with every problem and the range it concerns.
4. **Render.** ffmpeg cuts the long video and one Short (1080x1920, centre crop, captions burned
   in). Always runs, so a changed edit list renders again.
5. **Audio.** Both videos are levelled in two loudnorm passes to −14 LUFS with a true peak of at
   most −1 dBTP: the first measures, the second applies one linear gain, or loudnorm's dynamic
   levelling when one gain would push the peak over. loudnorm aims at −1.5 dBTP, since the AAC
   encode after it adds about 0.2 dB. The video is copied.
6. **Drafts.** Titles, description and transcript for publishing (below). Claude's titles and
   description are used when the edit list has them; otherwise they are drafted from the
   transcript.

## The files it writes

| File                          | What                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `long.mp4`, `long.srt`        | The long cut and its captions                                         |
| `short.mp4`, `short.ass`      | The Short and its burned-in captions                                  |
| `<slug>.kdenlive`             | The long cut as a Kdenlive project, chapters as guides                |
| `titles.md`                   | Three title options                                                   |
| `description.md`              | The description, ending with the chapters as YouTube timestamps       |
| `transcript.md`               | The cut's words under their chapter titles: raw material for the post |
| `transcript.json`             | whisper.cpp's word times                                              |
| `brief.md`, `edit-list.json`  | The request for the edit list, and the list                           |
| `claude-reply.txt`            | Claude's raw reply, when Claude was asked                             |

## Changing the cut

Edit `edit-list.json` (drop a cut, move the Short, rename a chapter) and run the same command
again. It reuses `transcript.json` and renders everything again. Delete `edit-list.json` to ask
Claude again, or `transcript.json` to transcribe again.

## Without Claude

`--no-claude` writes `brief.md` and stops. An agent in a Claude Code session reads it, writes its
JSON answer to `edit-list.json` in the same folder, and runs the command again: the transcript is
reused and the cut renders. An `edit-list.json` that is already there is used with or without the
flag.

## Tests

`infra/scripts/video-cut-lib.test.ts` and `video-cut.test.ts` (the steps against fake tools) run
in `deno task test`. `deno task video:test` runs the whole command on a generated 80 s clip with
fake `whisper-cli` and `claude` and real ffmpeg, and measures the loudness of both outputs. It
needs ffmpeg, so CI runs it in its own `video` step, only when a pull request changes the tool.
