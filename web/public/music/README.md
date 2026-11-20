# Your own Wrapped music (optional)

Wrapped ships with five original tracks generated in the browser, so it works with no files here.

To add songs, put audio files you have the rights to use (your own music, or royalty-free tracks
with a license that allows this) in this folder, then create `tracks.json` next to this file:

```json
[
  { "id": "victory", "title": "Victory", "artist": "Your Artist", "src": "/music/victory.mp3" }
]
```

Your tracks are listed first and play by default. Commercial songs (Spotify, YouTube, etc.) need a
license to be played on a public website, so don't add them without one.
